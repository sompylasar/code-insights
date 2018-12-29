const glob = require('glob');
const path = require('path');
const chalk = require('chalk');

const argv = require('minimist')(process.argv.slice(2));

const DEFAULT_EXTENSIONS = ['js', 'scss', 'sass', 'less', 'css', 'html', 'json', 'yml'];

const printUsageAndExit = require('../utils').printUsageAndExit;
if (argv['help']) {
  printUsageAndExit('Find duplicate file names across directories.', 'dup-names', '[options]', [
    ['--js-only', 'Scan JavaScript (.js) files only. Default: ' + DEFAULT_EXTENSIONS.join('|')],
    ['--help', 'This help.'],
  ]);
}

const ROOT_DIR = require('../utils').ROOT_DIR;
const handleError = require('../utils').handleError;
const padleft = require('../utils').padleft;

const GLOB = argv['js-only'] ? 'src/**/*.@(js)' : 'src/**/*.@(' + DEFAULT_EXTENSIONS.join('|') + ')';

// TODO(@sompylasar): Get IGNORE_RELATIVE_PATH_RE from CLI arguments or environment.
const IGNORE_RELATIVE_PATH_RE = /node_modules|bower_components|vendor|(^build\/)|(^static\/)|\/index\.[^/]+$/;

console.log(chalk.grey('Scanning ') + GLOB);

glob(
  GLOB,
  {
    cwd: ROOT_DIR,
    nodir: false,
    realpath: true,
  },
  function onGlob(globError, files) {
    if (globError) {
      handleError(globError);
      return;
    }

    const totals = {
      total: files.length,
      totalDuplicates: 0,
      maxDuplicates: 0,
    };

    console.log(chalk.grey('Files found: ') + totals.total);

    const filesGroupedByName = files
      .filter(function onEachFileFilter(file) {
        const relativePath = path.relative(ROOT_DIR, file);
        return !IGNORE_RELATIVE_PATH_RE.test(relativePath);
      })
      .reduce(function onEachFileReduce(accu, file) {
        const fileName = path.basename(file);
        if (!accu[fileName]) {
          accu[fileName] = { fileName: fileName, files: [] };
        }
        accu[fileName].files.push(file);
        return accu;
      }, {});

    const output = [];
    Object.keys(filesGroupedByName).forEach(function onEachFileGroupedByName(fileName) {
      const fileGroup = filesGroupedByName[fileName];
      const duplicatesCount = fileGroup.files.length - 1;
      if (duplicatesCount > 0) {
        totals.totalDuplicates += 1;

        if (duplicatesCount > totals.maxDuplicates) {
          totals.maxDuplicates = duplicatesCount;
        }

        let chalkColor = chalk.yellow;
        if (duplicatesCount > 2) {
          chalkColor = chalk.red;
        }

        output.push('- ' + fileName + chalkColor(' (' + fileGroup.files.length + ' files)'));
        fileGroup.files.forEach(function onEachFileInGroup(file) {
          const pathForDisplay = path.relative(ROOT_DIR, file);

          output.push(chalk.grey('  - ' + pathForDisplay));
        });
      }
    });

    console.log(
      '\n' +
        output.join('\n') +
        '\n\n' +
        chalk.grey('Total files:             ') +
        padleft(totals.total, 5) +
        '\n' +
        chalk.grey('Total duplicate names:   ') +
        padleft(totals.totalDuplicates, 5) +
        '\n' +
        chalk.grey('Max duplicates per name: ') +
        padleft(totals.maxDuplicates, 5) +
        '\n' +
        '\n',
    );
  },
);
