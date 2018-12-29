const debug = require('debug')('code-insights:js-complex');

const glob = require('glob');
const path_ = require('path');
const fs = require('fs');
const chalk = require('chalk');
const Listr = require('listr');
const prettyjson = require('prettyjson');
const escomplexWalker = require('escomplex/src/walker');
const escomplexProject = require('escomplex/src/project');
const babelEslint = require('babel-eslint');
const astTypes = require('ast-types');
const astBuilders = astTypes.builders;
const astDefine = astTypes.Type.def;
astDefine('ExperimentalSpreadProperty');
astDefine('ExperimentalRestProperty');
astTypes.finalize();

const argv = require('minimist')(process.argv.slice(2));

const printUsageAndExit = require('../utils').printUsageAndExit;
if (argv['help']) {
  printUsageAndExit(
    'Measure JavaScript code maintainability index of each source file via "escomplex".',
    'js-complex',
    '[options]',
    [
      ['--grep <regexp>', 'Regular expression to match the relative file paths against.'],
      ['--invert', 'Inverts the regular expression to ignore the matching files.'],
      ['--verbose', 'Print detailed report.'],
      ['--help', 'This help.'],
    ],
    ['', "--grep '.*/components/.*'", "--grep '.*/test/.*' --invert", '--verbose'],
  );
}

const ROOT_DIR = require('../utils').ROOT_DIR;
const handleError = require('../utils').handleError;
const padleft = require('../utils').padleft;
const padcenter = require('../utils').padcenter;
const strcmpRelativePathDirsBeforeFiles = require('../utils').strcmpRelativePathDirsBeforeFiles;

const GLOB = '**/*.js';

// TODO(@sompylasar): Get IGNORE_RELATIVE_PATH_RE from CLI arguments or environment.
const IGNORE_RELATIVE_PATH_RE = /node_modules|bower_components|vendor|(^build\/)|(^static\/)|(\bpackage\.json$)|(^\.eslintrc\.js$)|(\bnpm-shrinkwrap\.json$)/;

function parseCodeForEscomplex(code) {
  // TODO(@sompylasar): Load babel config from the target directory.
  const parserOptions = {
    ecmaFeatures: {
      legacyDecorators: true,
    },
  };
  const ast = babelEslint.parse(code, parserOptions);

  astTypes.visit(ast, {
    // WORKAROUND(@sompylasar): `escomplex` skips `ExportDefaultDeclaration` and `ExportNamedDeclaration` which may contain `FunctionDeclaration`. Replacing with declaration itself.
    visitExportDefaultDeclaration: function(path) {
      path.replace(path.node.declaration);
      this.traverse(path);
    },
    visitExportNamedDeclaration: function(path) {
      path.replace(path.node.declaration);
      this.traverse(path);
    },

    // WORKAROUND(@sompylasar): `escomplex` skips `ImportDeclaration`, so misses some dependencies. Replacing with `require` call.
    visitImportDeclaration: function(path) {
      const requireCall = astBuilders.callExpression(astBuilders.identifier('require'), [path.node.source]);
      requireCall.loc = path.node.loc;
      path.replace(requireCall);
      this.traverse(path);
    },

    // WORKAROUND(@sompylasar): `escomplex` skips `ArrowFunctionExpression`, so misses some functions. Replacing with `FunctionExpression`.
    visitArrowFunctionExpression: function(path) {
      let body = path.node.body;

      if (astTypes.namedTypes.Expression.check(body)) {
        body = astBuilders.blockStatement([astBuilders.returnStatement(body)]);
      }

      path.replace(astBuilders.functionExpression(null, path.node.params, body));

      this.traverse(path);
    },

    // WORKAROUND(@sompylasar): `escomplex` skips `ClassDeclaration`, so misses some functions. Replacing with `FunctionExpression`.
    visitClassDeclaration: function(path) {
      const pathClassBody = path.get('body');
      const classBodyItems = pathClassBody.node.body;
      const methods = classBodyItems.filter((item) => astTypes.namedTypes.MethodDefinition.check(item));
      const methodsArrow = classBodyItems.filter(
        (item) =>
          astTypes.namedTypes.ClassProperty.check(item) &&
          astTypes.namedTypes.ArrowFunctionExpression.check(item.value),
      );
      path.replace(
        astBuilders.arrayExpression(
          methods
            .map((method) => astBuilders.functionExpression(method.key, method.value.params, method.value.body))
            .concat(
              methodsArrow.map((methodArrow) =>
                astBuilders.functionExpression(methodArrow.key, methodArrow.value.params, methodArrow.value.body),
              ),
            ),
        ),
      );
      this.traverse(path);
    },
  });

  debug(require('util').inspect(ast.body, { depth: 20 }));

  return ast;
}

function processFile(file, next) {
  fs.readFile(file, { encoding: 'utf8' }, function onFileRead(error, content) {
    if (error) {
      next(error);
      return;
    }

    const contentString = content.toString();

    const stats = {
      path: file,
      astForEscomplex: parseCodeForEscomplex(contentString),
    };

    next(null, stats);
  });
}

function processAllFiles(files, next, onOneFileProcessed) {
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

      onOneFileProcessed(stats, fileIndex);

      nextFile(fileIndex + 1);
    });
  }

  nextFile(0);
}

const DEBUG = debug.enabled;
const DEBUG_FILE_PATH = process.env.DEBUG_FILE_PATH ? path_.join(ROOT_DIR, process.env.DEBUG_FILE_PATH) : null;

// https://github.com/escomplex/escomplex/blob/master/METRICS.md#metrics
// Maintainability index: Defined by Paul Oman & Jack Hagemeister in 1991,
// this is a logarithmic scale from negative infinity to 171, calculated
// from the logical lines of code, the cyclomatix complexity and the Halstead effort.
// Higher is better.
const MAINTAINABILITY_MAX = 171;
const MAINTAINABILITY_LOW = 100;
const MAINTAINABILITY_MEDIUM = 140;

/**
 * Returns `chalk` color function based on the maintainability index.
 *
 * @param  {number}  maintainability  The maintainability index.
 * @return  {Function}  The `chalk` color function.
 */
function maintainabilityColor(maintainability) {
  if (maintainability > MAINTAINABILITY_MEDIUM) {
    return chalk.green;
  }

  if (maintainability > MAINTAINABILITY_LOW) {
    return chalk.yellow;
  }

  return chalk.red;
}

const taskDescriptors = [
  {
    title: chalk.grey('Find files'),
    task: (ctx, task) => {
      if (DEBUG && DEBUG_FILE_PATH) {
        ctx.files = [DEBUG_FILE_PATH];
        const files = ctx.files;
        task.title = chalk.grey('Files found: ') + files.length;
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const grepRegexp = argv['grep'] ? new RegExp(argv['grep']) : null;
        const grepInvert = !!argv['invert'];

        const filemaskDisplayString =
          GLOB + (grepRegexp ? chalk.grey(' with ') + (grepInvert ? '!' : '') + grepRegexp : '');

        task.title = chalk.grey('Scanning ') + filemaskDisplayString;

        glob(
          GLOB,
          {
            cwd: ROOT_DIR,
            dot: false,
            nodir: true,
            realpath: true,
          },
          function onGlob(globError, filesFromGlob) {
            if (globError) {
              reject(globError);
              return;
            }

            const files = filesFromGlob.filter(function onFilesFilter(file) {
              const relativePath = path_.relative(ROOT_DIR, file);
              return (
                !IGNORE_RELATIVE_PATH_RE.test(relativePath) &&
                (!grepRegexp || (grepInvert ? !grepRegexp.test(relativePath) : grepRegexp.test(relativePath)))
              );
            });

            ctx.files = files;

            task.title =
              chalk.grey('Files found: ') + files.length + chalk.grey(' (') + filemaskDisplayString + chalk.grey(')');

            resolve();
          },
        );
      });
    },
  },
  {
    title: chalk.grey('Parse files'),
    task: (ctx, task) => {
      const files = ctx.files;

      task.title = chalk.grey('Files to parse: ') + files.length;

      return new Promise((resolve, reject) => {
        ctx.totals = {
          total: files.length,
          isIgnored: 0,
          topUnmaintainableFiles: [],
          lowestMaintainability: MAINTAINABILITY_MAX,
          lowestMaintainabilityStats: null,
        };

        processAllFiles(
          files,
          function onAllFilesProcessed(processAllFilesError, statsAll) {
            if (processAllFilesError) {
              reject(processAllFilesError);
              return;
            }

            statsAll.forEach(function(stats) {
              stats.pathForDisplay = path_.relative(ROOT_DIR, stats.path);
            });

            statsAll.sort(function(left, right) {
              return strcmpRelativePathDirsBeforeFiles(left.pathForDisplay, right.pathForDisplay);
            });

            ctx.statsAll = statsAll;

            task.title = chalk.grey('Files parsed: ') + statsAll.length;

            resolve();
          },
          function onOneFileProcessed(stats, fileIndex) {
            task.title = chalk.grey('Files remaining to parse: ') + (files.length - fileIndex);
          },
        );
      });
    },
  },
  {
    title: chalk.grey('Analyze code complexity'),
    task: (ctx, task) => {
      const statsAll = ctx.statsAll;

      task.title = chalk.grey('Analyzing code complexity...');

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          // NOTE(@sompylasar): `escomplex` analysis is synchronous.
          try {
            const escomplexProjectModules = statsAll.map((stats) => ({ ast: stats.astForEscomplex, path: stats.path }));
            const escomplexReportAll = escomplexProject.analyse(escomplexProjectModules, escomplexWalker, {
              skipCalculation: true,
            });

            statsAll.forEach(function(stats, statsIndex) {
              stats.escomplexReport = escomplexReportAll.reports[statsIndex];
              delete stats.escomplexReport.path;
            });

            statsAll.escomplexReportAll = escomplexReportAll;

            resolve();
          } catch (ex) {
            reject(ex);
          }
        }, 200);
      });
    },
  },
  {
    title: chalk.grey('Generate report'),
    task: (ctx, task) => {
      task.title = chalk.grey('Generating report...');

      return new Promise((resolve) => {
        setTimeout(() => {
          const totals = ctx.totals;
          const statsAll = ctx.statsAll;

          let report = '';

          statsAll.forEach(function onStatsMap(stats) {
            const isIgnored = false;

            totals.isIgnored += isIgnored ? 1 : 0;

            const escomplexReport = stats.escomplexReport;

            let status;
            let pathForDisplayWithColor;
            if (isIgnored) {
              status = chalk.grey('[ IGNORE ] ');
              pathForDisplayWithColor = chalk.grey(stats.pathForDisplay);
            } else {
              const chalkColor = maintainabilityColor(escomplexReport.maintainability);
              status = chalkColor('[ ' + padcenter(Math.round(stats.escomplexReport.maintainability), 6) + ' ] ');
              pathForDisplayWithColor = chalkColor(stats.pathForDisplay);

              if (escomplexReport.maintainability < totals.lowestMaintainability) {
                totals.lowestMaintainability = escomplexReport.maintainability;
                totals.lowestMaintainabilityStats = stats;
              }
            }

            report += status + pathForDisplayWithColor + '\n';

            if (!isIgnored) {
              if (argv['verbose']) {
                report +=
                  padleft('', 11) +
                  chalk.grey('`escomplex` report:\n') +
                  padleft('', 15) +
                  prettyjson
                    .render(escomplexReport)
                    .split('\n')
                    .join('\n' + padleft('', 15)) +
                  '\n\n' +
                  '\n';
              }
            }
          });

          totals.topUnmaintainableFiles = statsAll
            .slice(0)
            .sort(function(left, right) {
              return left.escomplexReport.maintainability - right.escomplexReport.maintainability;
            })
            .filter((stats) => stats.escomplexReport.maintainability <= MAINTAINABILITY_LOW)
            .filter(function(stats, index) {
              return index < 20;
            });

          report +=
            '\n' +
            chalk.grey('Total files:  ' + totals.total) +
            '\n' +
            (totals.isIgnored > 0 ? chalk.grey('Ignored files: ' + totals.isIgnored) + '\n' : '') +
            (totals.lowestMaintainabilityStats
              ? chalk.grey(
                  'Lowest maintainability index: ' +
                    Math.round(totals.lowestMaintainability) +
                    ' ' +
                    totals.lowestMaintainabilityStats.pathForDisplay,
                ) + '\n'
              : '') +
            (totals.topUnmaintainableFiles.length <= 0
              ? chalk.grey('No files with low maintainability.')
              : chalk.grey('' + totals.topUnmaintainableFiles.length + ' files with low maintainability:') +
                '\n' +
                totals.topUnmaintainableFiles
                  .map(function(stats) {
                    return (
                      maintainabilityColor(stats.escomplexReport.maintainability)(
                        padleft(Math.round(stats.escomplexReport.maintainability), 10),
                      ) +
                      ' ' +
                      chalk.grey(stats.pathForDisplay)
                    );
                  })
                  .join('\n')) +
            '\n' +
            '\n';

          report +=
            chalk.grey('See ') +
            chalk.blue.underline('https://github.com/escomplex/escomplex/blob/master/METRICS.md#metrics') +
            chalk.grey(' for details on report metrics.') +
            '\n';

          ctx.report = report;

          task.title = chalk.grey('Done.');

          setTimeout(() => {
            resolve();
          });
        }, 200);
      });
    },
  },
];

new Listr(taskDescriptors)
  .run()
  .then((ctx) => {
    console.log('\n' + ctx.report);
  })
  .catch((error) => {
    handleError(error);
  });
