const glob = require('glob');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const argv = require('minimist')(process.argv.slice(2));

const printUsageAndExit = require('../utils').printUsageAndExit;
if (argv['help']) {
  printUsageAndExit(
    'Find files that may contain React Redux connected components, i.e. import from "react-redux" or "redux-form".',
    'react-redux-connect',
    '[options]',
    [['--help', 'This help.']],
  );
}

const ROOT_DIR = require('../utils').ROOT_DIR;
const handleError = require('../utils').handleError;
const strcmpRelativePathDirsBeforeFiles = require('../utils').strcmpRelativePathDirsBeforeFiles;
const padleft = require('../utils').padleft;
const padcenter = require('../utils').padcenter;
const percent = require('../utils').percent;

// TODO(@sompylasar): Get GLOB and DISPLAY_ROOT_DIR from CLI arguments or environment.
const GLOB = 'src/**/*.js';
const DISPLAY_ROOT_DIR = 'src/';

// TODO(@sompylasar): Get IGNORE_RELATIVE_PATH_RE from CLI arguments or environment.
const IGNORE_RELATIVE_PATH_RE = /node_modules|bower_components|vendor/;

// TODO(@sompylasar): Get CUSTOM_CONNECT_IMPORT_STATEMENTS from CLI arguments or environment.
const CUSTOM_CONNECT_IMPORT_STATEMENTS = [];

function processFile(file, next) {
  fs.readFile(file, { encoding: 'utf8' }, function onFileRead(error, content) {
    if (error) {
      next(error);
      return;
    }

    const contentString = content.toString();

    // TODO(@sompylasar): Parse the code instead of matching with RegExp to find all possible code layouts (slower).
    // NOTE(@sompylasar): Keep the stats as numbers to maybe later add counting of the number of connections to the store.
    const isConnectedWithStore =
      contentString.indexOf("import { connect } from 'react-redux'") >= 0 ||
      contentString.indexOf('import { connect } from "react-redux"') >= 0 ||
      /\bconnect\b[^}]*}\s+from\s+(['"])react-redux\1/gm.test(contentString)
        ? 1
        : 0;

    const isConnectedWithReduxForm =
      contentString.indexOf("import { reduxForm } from 'redux-form'") >= 0 ||
      contentString.indexOf('import { reduxForm } from "redux-form"') >= 0 ||
      /\breduxForm\b[^}]*}\s+from\s+(['"])redux-form\1/gm.test(contentString)
        ? 1
        : 0;

    const isConnectedWithCustomConnect = CUSTOM_CONNECT_IMPORT_STATEMENTS.reduce(
      (accu, importStatementCode) => (accu + contentString.indexOf(importStatementCode) >= 0 ? 1 : 0),
      0,
    );

    const isConnectedTotal = isConnectedWithStore + isConnectedWithReduxForm + isConnectedWithCustomConnect;

    const stats = {
      path: file,
      isConnectedWithStore: isConnectedWithStore,
      isConnectedWithReduxForm: isConnectedWithReduxForm,
      isConnectedWithCustomConnect: isConnectedWithCustomConnect,
      isConnectedTotal: isConnectedTotal,
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
      isIgnored: 0,
      isConnectedWithStore: 0,
      isConnectedWithReduxForm: 0,
      isConnectedWithCustomConnect: 0,
      isConnectedTotal: 0,
    };

    console.log(chalk.grey('Files found: ') + totals.total);

    processAllFiles(files, function onAllFilesProcessed(processAllFilesError, statsAll) {
      if (processAllFilesError) {
        handleError(processAllFilesError);
        return;
      }

      statsAll.forEach(function(stats) {
        stats.pathForDisplay = path.relative(DISPLAY_ROOT_DIR, path.relative(ROOT_DIR, stats.path));
      });

      statsAll.sort(function(left, right) {
        return strcmpRelativePathDirsBeforeFiles(left.pathForDisplay, right.pathForDisplay);
      });

      console.log(chalk.grey('Files processed: ') + statsAll.length + '\n');

      statsAll.forEach(function onStatsMap(stats) {
        const isIgnored = false;
        const isConnected = stats.isConnectedTotal > 0;
        const isConnectedMoreThanOnce = stats.isConnectedTotal > 1;

        totals.isIgnored += isIgnored ? 1 : 0;

        if (!isIgnored) {
          totals.isConnectedWithStore += stats.isConnectedWithStore ? 1 : 0;
          totals.isConnectedWithReduxForm += stats.isConnectedWithReduxForm ? 1 : 0;
          totals.isConnectedWithCustomConnect += stats.isConnectedWithCustomConnect ? 1 : 0;
          totals.isConnectedTotal += isConnected ? 1 : 0;
        }

        let status;
        let pathForDisplayWithColor;
        if (isIgnored) {
          status = chalk.grey('[ IGNORE ] ');
          pathForDisplayWithColor = chalk.grey(stats.pathForDisplay);
        } else if (isConnected) {
          const chalkColor = isConnectedMoreThanOnce ? chalk.red : chalk.yellow;
          status = chalkColor('[ ' + padcenter(stats.isConnectedTotal, 6) + ' ] ');
          pathForDisplayWithColor = chalkColor(stats.pathForDisplay);
        } else {
          status = chalk.green('[   OK   ] ');
          pathForDisplayWithColor = chalk.green(stats.pathForDisplay);
        }

        console.log(status + pathForDisplayWithColor);
      });

      const totalWithoutIgnored = totals.total - totals.isIgnored;

      console.log(
        '\n' +
          chalk.grey('Total: ' + totals.total) +
          '\n' +
          (totals.isIgnored > 0 ? chalk.grey('Ignored: ' + totals.isIgnored) + '\n' : '') +
          chalk.green(
            'Not connected:  ' +
              padleft(totalWithoutIgnored - totals.isConnectedTotal, 4) +
              percent(totalWithoutIgnored - totals.isConnectedTotal, totalWithoutIgnored),
          ) +
          '\n' +
          chalk.yellow(
            'Connected:      ' +
              padleft(totals.isConnectedTotal, 4) +
              percent(totals.isConnectedTotal, totalWithoutIgnored),
          ) +
          '\n' +
          '\n',
      );
    });
  },
);
