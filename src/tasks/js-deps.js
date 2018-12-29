const glob = require('glob');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const lodashUniq = require('lodash/uniq');

const argv = require('minimist')(process.argv.slice(2));

const printUsageAndExit = require('../utils').printUsageAndExit;
if (argv['help']) {
  printUsageAndExit('Find dependencies inside source code files.', 'js-deps', '[options]', [
    ['--verbose', 'List all found dependencies.'],
    ['--help', 'This help.'],
  ]);
}

const ROOT_DIR = require('../utils').ROOT_DIR;
const handleError = require('../utils').handleError;
const padleft = require('../utils').padleft;
const padcenter = require('../utils').padcenter;
const strcmpRelativePathDirsBeforeFiles = require('../utils').strcmpRelativePathDirsBeforeFiles;
const makeHistogramAsciiChart = require('../utils').makeHistogramAsciiChart;

const GLOB = '**/@(.babelrc|*.js)';

// TODO(@sompylasar): Get IGNORE_RELATIVE_PATH_RE from CLI arguments or environment.
const IGNORE_RELATIVE_PATH_RE = /node_modules|bower_components|vendor|(^build\/)|(^static\/)|(\bpackage\.json$)|(^\.eslintrc\.js$)|(\bnpm-shrinkwrap\.json$)/;

function log(line) {
  process.stdout.write(line + '\n');
}

const packageJsonPath = path.join(ROOT_DIR, 'package.json');
let packageJson = null;
let packageJsonDependencies = [];
let packageJsonDevDependencies = [];
try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath));
  packageJsonDependencies = Object.keys(packageJson.dependencies || {});
  packageJsonDevDependencies = Object.keys(packageJson.devDependencies || {});
} catch (ex) {
  log('No package.json found, or unable to load it.');
  // IGNORE_EXCEPTION: Assuming no package.json is available.
}

// TODO(@sompylasar): Ask eslint to resolve its config in the target directory.
let eslintConfigFound = null;
let eslintConfigFoundPath = null;
// eslint-disable-next-line import/no-dynamic-require
const readJsEslintConfig = (eslintConfigPath) => require(eslintConfigPath);
const readJsonEslintConfig = (eslintConfigPath) => JSON.parse(fs.readFileSync(eslintConfigPath));
[
  ['.eslintrc.js', readJsEslintConfig],
  ['.eslintrc.json', readJsonEslintConfig],
  ['.eslintrc', readJsonEslintConfig],
].forEach(function onEslintConfig(entry) {
  if (eslintConfigFound) {
    return;
  }
  try {
    const eslintConfigPath = path.join(ROOT_DIR, entry[0]);
    const eslintConfigReadFn = entry[1];
    eslintConfigFound = eslintConfigReadFn(eslintConfigPath);
    eslintConfigFoundPath = eslintConfigPath;
  } catch (ex) {
    log('No eslint config found, or unable to load it.');
    // IGNORE_EXCEPTION: Assuming no eslint config is available.
  }
});

// http://cwestblog.com/2013/02/26/javascript-string-prototype-matchall/
function matchAll(str, regexp) {
  const matches = [];
  str.replace(regexp, function onMatch() {
    const arr = [].slice.call(arguments, 0);
    const extras = arr.splice(-2);
    arr.index = extras[0];
    arr.input = extras[1];
    matches.push(arr);
  });
  return matches;
}

function processFile(file, next) {
  fs.readFile(file, { encoding: 'utf8' }, function onFileRead(error, content) {
    if (error) {
      next(error);
      return;
    }

    const contentString = content.toString();

    // TODO(@sompylasar): Parse the code instead of matching with RegExp to find all possible code layouts (slower).
    const dependencies = matchAll(
      contentString,
      /(^\s+import\s+.*?\s+from\s+(['"])([^']+)\2)|(\brequire\((['"])([^']+)\5\))/gm,
    )
      .map(function onMatchAllMap(match) {
        return match[3] || match[6];
      })
      .filter(function onDependencyFilter(dependency) {
        return !!dependency;
      });

    if (file !== __filename) {
      // NOTE(@sompylasar): Some dependencies are implicit, specified as strings, some as only tiny part of the package name, such as `babel-preset-react` is mentioned as `react`.
      // NOTE(@sompylasar): The following heuristical piece of code tries to find them among the strings found in specific files where these implicit dependencies are expected.
      const dependenciesAsStrings = matchAll(contentString, /(['"])([a-zA-Z][a-zA-Z0-9.-]+)(\1|[?!/])/g)
        .map(function onMatchAllMap(match) {
          const dependency = match[2];
          if (dependency && dependencies.indexOf(dependency) < 0) {
            // NOTE(@sompylasar): Babel config references its plugins and presets implicitly, as well as `react-transform`.
            if (/\.babelrc$/.test(file) || /babel/.test(file)) {
              if (
                packageJsonDependencies.indexOf('babel-plugin-' + dependency) >= 0 ||
                packageJsonDevDependencies.indexOf('babel-plugin-' + dependency) >= 0
              ) {
                return 'babel-plugin-' + dependency;
              } else if (
                packageJsonDependencies.indexOf('babel-preset-' + dependency) >= 0 ||
                packageJsonDevDependencies.indexOf('babel-preset-' + dependency) >= 0
              ) {
                return 'babel-preset-' + dependency;
              } else if (
                packageJsonDependencies.indexOf(dependency) >= 0 ||
                packageJsonDevDependencies.indexOf(dependency) >= 0
              ) {
                // NOTE(@sompylasar): This matches fully qualified names for `react-transform` and its transforms.
                return dependency;
              }
            }

            // NOTE(@sompylasar): Webpack config references its loaders implicitly.
            if (/\/webpack\//.test(file)) {
              if (
                packageJsonDependencies.indexOf(dependency + '-loader') >= 0 ||
                packageJsonDevDependencies.indexOf(dependency + '-loader') >= 0
              ) {
                // NOTE(@sompylasar): Although we try to specify loaders by names explicitly, some copy-paste may result in partial loader name.
                return dependency + '-loader';
              } else if (
                packageJsonDependencies.indexOf(dependency) >= 0 ||
                packageJsonDevDependencies.indexOf(dependency) >= 0
              ) {
                // NOTE(@sompylasar): This matches fully qualified loader names.
                return dependency;
              }
            }
          }
          return null;
        })
        .filter(function onDependencyAsStringFilter(dependency) {
          return !!dependency;
        });

      dependencies.push.apply(dependencies, dependenciesAsStrings);
    }

    const stats = {
      path: file,
      dependencies: lodashUniq(dependencies),
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

function processPackageJson() {
  // NOTE(@sompylasar): `package.json` implicitly depends on CLI commands of installed packages via scripts.
  const stats = {
    path: packageJsonPath,
    dependencies: [],
  };
  packageJsonDependencies.forEach(function onPackageJsonDependency(dependency) {
    Object.keys(packageJson.scripts).forEach(function onPackageJsonScript(scriptName) {
      if (packageJson.scripts[scriptName].indexOf(dependency) >= 0) {
        stats.dependencies.push(dependency);
      }
    });
  });
  packageJsonDevDependencies.forEach(function onPackageJsonDevDependency(dependency) {
    Object.keys(packageJson.scripts).forEach(function onPackageJsonScript(scriptName) {
      if (packageJson.scripts[scriptName].indexOf(dependency) >= 0) {
        stats.dependencies.push(dependency);
      }
    });
  });
  stats.dependencies = lodashUniq(stats.dependencies);
  return stats;
}

function processEslintConfig() {
  if (!eslintConfigFound) {
    return null;
  }
  // NOTE(@sompylasar): Eslint config implicitly depends on its base config, parser, plugins and resolvers by string name.
  const stats = {
    path: eslintConfigFoundPath,
    dependencies: [],
  };
  if (Array.isArray(eslintConfigFound.extends)) {
    eslintConfigFound.extends.forEach(function onEslintPlugin(extendsSpec) {
      if (/^plugin:/.test(extendsSpec)) {
        stats.dependencies.push('eslint-plugin-' + extendsSpec.replace(/^plugin:/, '').replace(/\/.*/, ''));
      } else if (/^eslint:/.test(extendsSpec)) {
        // eslint itself
      } else {
        stats.dependencies.push('eslint-config-' + extendsSpec);
      }
    });
  } else if (typeof eslintConfigFound.extends === 'string') {
    stats.dependencies.push(eslintConfigFound.extends);
  }
  if (eslintConfigFound.parser) {
    stats.dependencies.push(eslintConfigFound.parser);
  }
  (eslintConfigFound.plugins || []).forEach(function onEslintPlugin(plugin) {
    stats.dependencies.push('eslint-plugin-' + plugin);
  });
  const eslintImportResolverSettings =
    (eslintConfigFound.settings && eslintConfigFound.settings['import/resolver']) || {};
  Object.keys(eslintImportResolverSettings).forEach(function onEslintImportResolver(plugin) {
    stats.dependencies.push('eslint-import-resolver-' + plugin);
  });
  stats.dependencies = lodashUniq(stats.dependencies);
  return stats;
}

log(chalk.grey('Scanning ') + GLOB);

glob(
  GLOB,
  {
    cwd: ROOT_DIR,
    dot: true,
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
      isIgnored: 0,
      dependenciesHistogram: {},
      devDependenciesHistogram: {},
      maxDependenciesPerFile: 0,
    };

    const addDependency = function(packageName) {
      if (packageName) {
        if (!totals.dependenciesHistogram[packageName]) {
          totals.dependenciesHistogram[packageName] = 0;
        }
        totals.dependenciesHistogram[packageName] += 1;
      }
    };

    const addDevDependency = function(packageName) {
      if (packageName) {
        if (!totals.devDependenciesHistogram[packageName]) {
          totals.devDependenciesHistogram[packageName] = 0;
        }
        totals.devDependenciesHistogram[packageName] += 1;
      }
    };

    const packageJsonStats = processPackageJson();
    if (packageJsonStats) {
      ++totals.total;
    }

    const eslintStats = processEslintConfig();
    if (eslintStats) {
      ++totals.total;
    }

    log(chalk.grey('Files found: ') + totals.total);

    processAllFiles(files, function onAllFilesProcessed(processAllFilesError, statsAll) {
      if (processAllFilesError) {
        handleError(processAllFilesError);
        return;
      }

      if (packageJsonStats) {
        statsAll.push(packageJsonStats);
      }

      if (eslintStats) {
        statsAll.push(eslintStats);
      }

      statsAll.forEach(function(stats) {
        stats.pathForDisplay = path.relative(ROOT_DIR, stats.path);
      });

      statsAll.sort(function(left, right) {
        return strcmpRelativePathDirsBeforeFiles(left.pathForDisplay, right.pathForDisplay);
      });

      log(chalk.grey('Files processed: ') + statsAll.length + '\n');

      statsAll.forEach(function onStatsMap(stats) {
        const isIgnored = false;

        totals.isIgnored += isIgnored ? 1 : 0;

        stats.dependencies.forEach(function onDependency(dependency) {
          const dependencyPackageNameMatch = dependency.match(/^([^/]+)/);
          if (dependencyPackageNameMatch && dependencyPackageNameMatch[1] && dependencyPackageNameMatch[1] !== '.') {
            const dependencyPackageName = dependencyPackageNameMatch[1];
            if (packageJsonDependencies.indexOf(dependencyPackageName) >= 0) {
              addDependency(dependencyPackageName);
            }
            if (packageJsonDevDependencies.indexOf(dependencyPackageName) >= 0) {
              addDevDependency(dependencyPackageName);
            }
          }
        });
        const dependenciesCount = stats.dependencies.length;

        if (dependenciesCount > totals.maxDependenciesPerFile) {
          totals.maxDependenciesPerFile = dependenciesCount;
        }

        let status;
        let pathForDisplayWithColor;
        if (isIgnored) {
          status = chalk.grey('[ IGNORE ] ');
          pathForDisplayWithColor = chalk.grey(stats.pathForDisplay);
        } else if (dependenciesCount > 1) {
          const chalkColor = dependenciesCount > 10 ? chalk.red : chalk.yellow;
          status = chalkColor('[ ' + padcenter(dependenciesCount, 6) + ' ] ');
          pathForDisplayWithColor = chalkColor(stats.pathForDisplay);
        } else {
          status = chalk.green('[    0   ] ');
          pathForDisplayWithColor = chalk.green(stats.pathForDisplay);
        }

        log(status + pathForDisplayWithColor);

        if (argv['verbose']) {
          stats.dependencies.forEach((dependency) => {
            log(padleft('', 10) + ' ' + dependency);
          });
        }
      });

      // `peerDependencies`
      if (totals.dependenciesHistogram['bootstrap-sass-loader'] > 0) {
        addDependency('bootstrap-sass');
        addDependency('style-loader');
      }
      if (totals.dependenciesHistogram['font-awesome-sass-loader'] > 0) {
        addDependency('font-awesome');
      }
      if (totals.dependenciesHistogram['sass-loader'] > 0) {
        addDependency('node-sass');
      }
      if (totals.devDependenciesHistogram['sasslint-webpack-plugin'] > 0) {
        addDependency('node-sass');
      }

      totals.topDependenciesFiles = statsAll
        .slice(0)
        .sort(function(left, right) {
          return -(left.dependencies.length - right.dependencies.length);
        })
        .filter(function(stats, index) {
          return index < 15;
        });

      log('\n' + chalk.grey('Number of files that depend on external `dependencies`:'));
      makeHistogramAsciiChart(totals.dependenciesHistogram, {
        sortByLabel: true,
      }).forEach(function onHistogramLine(line) {
        log(line);
      });

      log('\n' + chalk.grey('Number of files that depend on external `devDependencies`:'));
      makeHistogramAsciiChart(totals.devDependenciesHistogram, {
        sortByLabel: true,
      }).forEach(function onHistogramLine(line) {
        log(line);
      });

      log(
        '\n' +
          chalk.grey('Total files:  ' + totals.total) +
          '\n' +
          (totals.isIgnored > 0 ? chalk.grey('Ignored files: ' + totals.isIgnored) + '\n' : '') +
          chalk.grey('Max dependencies per file: ') +
          padleft(totals.maxDependenciesPerFile, 5) +
          '\n' +
          chalk.grey('Top ' + totals.topDependenciesFiles.length + ' by number of dependencies:') +
          '\n' +
          totals.topDependenciesFiles
            .map(function(stats) {
              return (
                padleft(stats.dependencies.length, 10) +
                ' ' +
                chalk.grey(stats.pathForDisplay) +
                (argv['verbose'] ? '\n' + padleft('', 11) + stats.dependencies.join('\n' + padleft('', 11)) + '\n' : '')
              );
            })
            .join('\n') +
          '\n' +
          '\n',
      );
    });
  },
);
