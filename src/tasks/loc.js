const glob = require('glob');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const argv = require('minimist')(process.argv.slice(2));

const DEFAULT_EXTENSIONS = ['js', 'scss', 'sass', 'less', 'css', 'html', 'json', 'yml'];

const printUsageAndExit = require('../utils').printUsageAndExit;
if (argv['help']) {
  printUsageAndExit('Count lines of code (LOC) of each file, aggregate statistics.', 'loc', '[options]', [
    ['--js-only', 'Scan JavaScript (.js) files only. Default: ' + DEFAULT_EXTENSIONS.join('|')],
    ['--help', 'This help.'],
  ]);
}

const ROOT_DIR = require('../utils').ROOT_DIR;
const handleError = require('../utils').handleError;
const strcmpRelativePathDirsBeforeFiles = require('../utils').strcmpRelativePathDirsBeforeFiles;
const padleft = require('../utils').padleft;
const makeHistogramAsciiChart = require('../utils').makeHistogramAsciiChart;

const GLOB = argv['js-only'] ? 'src/**/*.@(js)' : 'src/**/*.@(' + DEFAULT_EXTENSIONS.join('|') + ')';

// TODO(@sompylasar): Get IGNORE_RELATIVE_PATH_RE from CLI arguments or environment.
const IGNORE_RELATIVE_PATH_RE = /node_modules|bower_components|vendor/;

function processFile(file, next) {
  fs.readFile(file, { encoding: 'utf8' }, function onFileRead(error, content) {
    if (error) {
      next(error);
      return;
    }

    const contentString = content.toString();

    const codeWithoutBlockComments = contentString.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');

    const linesOfCodeWithoutEmptyLinesAndLineComments = codeWithoutBlockComments
      .split(/\n+/)
      .filter((x) => !/^(\s*)(\/\/.*)?$/.test(x));

    const stats = {
      path: file,
      fileLoc: linesOfCodeWithoutEmptyLinesAndLineComments.length,
    };

    next(null, stats);
  });
}

function processAllFiles(files, next) {
  const statsAll = [];

  function nextFile(fileIndex) {
    if (fileIndex >= files.length) {
      next(null, statsAll);
      return;
    }

    processFile(files[fileIndex], function onFileProcessed(error, stats) {
      if (error) {
        next(error);
        return;
      }

      if (stats) {
        statsAll.push(stats);
      }

      nextFile(fileIndex + 1);
    });
  }

  nextFile(0);
}

console.log(chalk.grey('Scanning ') + GLOB);

glob(
  GLOB,
  {
    cwd: ROOT_DIR,
    nodir: true,
    realpath: true,
  },
  function onGlob(globError, filesFromGlob) {
    if (globError) {
      handleError(globError);
      return;
    }

    const files = filesFromGlob.filter(function onFilesFilter(file) {
      const relativePath = path.relative(ROOT_DIR, file);
      return !IGNORE_RELATIVE_PATH_RE.test(relativePath);
    });

    const totals = {
      total: files.length,
      totalLoc: 0,
      histogramLoc: {},
      histogramLocBucketed: {},
      maxLoc: 0,
      maxLocPathForDisplay: null,
      topLocFiles: [],
    };

    console.log(chalk.grey('Files found: ') + totals.total);

    processAllFiles(files, function onAllFilesProcessed(processAllFilesError, statsAll) {
      if (processAllFilesError) {
        handleError(processAllFilesError);
        return;
      }

      statsAll.forEach(function(stats) {
        stats.pathForDisplay = path.relative(ROOT_DIR, stats.path);
      });

      statsAll.sort(function(left, right) {
        return strcmpRelativePathDirsBeforeFiles(left.pathForDisplay, right.pathForDisplay);
      });

      console.log(chalk.grey('Files processed: ') + statsAll.length + '\n');

      statsAll.forEach(function onStatsMap(stats) {
        totals.totalLoc += stats.fileLoc;
        totals.histogramLoc[stats.fileLoc] = (totals.histogramLoc[stats.fileLoc] || 0) + 1;

        if (stats.fileLoc >= totals.maxLoc) {
          totals.maxLoc = stats.fileLoc;
          totals.maxLocPathForDisplay = stats.pathForDisplay;
        }

        const bucket = 10;
        const bucketKey = Math.ceil(stats.fileLoc / bucket) * bucket;
        totals.histogramLocBucketed[bucketKey] = (totals.histogramLocBucketed[bucketKey] || 0) + 1;

        const status = '[ ' + padleft(stats.fileLoc, 6) + ' ] ';
        const pathForDisplayWithColor = chalk.grey(stats.pathForDisplay);

        // eslint-disable-next-line no-constant-condition
        if (false) {
          console.log(status + pathForDisplayWithColor);
        }
      });

      totals.topLocFiles = statsAll
        .slice(0)
        .sort(function(left, right) {
          return -(left.fileLoc - right.fileLoc);
        })
        .filter(function(stats, index) {
          return index < 15;
        });

      totals.bottomLocFiles = statsAll
        .slice(0)
        .sort(function(left, right) {
          return left.fileLoc - right.fileLoc;
        })
        .filter(function(stats, index) {
          return index < 15;
        });

      makeHistogramAsciiChart(totals.histogramLocBucketed, {
        displayRange: true,
      }).forEach(function onHistogramLine(line) {
        console.log(line);
      });

      console.log(
        '\n' +
          chalk.grey('Total files:   ') +
          padleft(totals.total, 10) +
          '\n' +
          chalk.grey('Total LOC:     ') +
          padleft(totals.totalLoc, 10) +
          '\n' +
          chalk.grey('Average LOC:   ') +
          padleft((totals.totalLoc / totals.total).toFixed(0), 10) +
          '\n' +
          chalk.grey('Top ' + totals.topLocFiles.length + ' LOC:') +
          '\n' +
          totals.topLocFiles
            .map(function(stats) {
              return padleft(stats.fileLoc, 10) + ' ' + chalk.grey(stats.pathForDisplay);
            })
            .join('\n') +
          '\n' +
          '\n' +
          chalk.grey('Bottom ' + totals.bottomLocFiles.length + ' LOC:') +
          '\n' +
          totals.bottomLocFiles
            .map(function(stats) {
              return padleft(stats.fileLoc, 10) + ' ' + chalk.grey(stats.pathForDisplay);
            })
            .join('\n') +
          '\n' +
          '\n',
      );
    });
  },
);
