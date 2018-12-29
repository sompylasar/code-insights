const glob = require('glob');
const leasot = require('leasot');
const path = require('path');
const fs = require('fs');

const argv = require('minimist')(process.argv.slice(2));

const OUTPUT_FILE_NAME = 'TODO.md';

const printUsageAndExit = require('../utils').printUsageAndExit;
if (argv['help']) {
  printUsageAndExit('Collect TODO comments from source code files into a Markdown list.', 'todo', '[options]', [
    ['--write [filename]', 'Write the file and add it to Git. Default file name: ' + OUTPUT_FILE_NAME],
    ['--team-username <username>', 'GitHub username of the team.'],
    ['--skip-git', 'Do not try to add the file to Git.'],
    ['--help', 'This help.'],
  ]);
}

const gitAdd = require('../utils').gitAdd;
const handleError = require('../utils').handleError;
const ROOT_DIR = require('../utils').ROOT_DIR;
const REPO_BASE_URL = '';
const TEAM_USERNAME = argv['team-username'] || '';

const TAGS = 'TODO, HACK, WORKAROUND, FIXME, XXX, QUESTION, REVIEW, IDEA'.split(/\s*,\s*/);
// eslint-disable-next-line no-constant-condition
if (false) {
  TAGS.push.apply(TAGS, 'WARNING, NOTE, CHANGED'.split(/\s*,\s*/));
}

const GLOB = '@(src|bin|webpack|cypress)/**/*';
const GLOB_IGNORE = [];

// TODO(@sompylasar): Get IGNORE_RELATIVE_PATH_RE from CLI arguments or environment.
const IGNORE_RELATIVE_PATH_RE = /node_modules|bower_components|vendor/;

const OUTPUT_FILE_PATH = argv['write']
  ? typeof argv['write'] === 'string' && argv['write'].trim() !== '-'
    ? path.join(ROOT_DIR, argv['write'].trim())
    : path.join(ROOT_DIR, OUTPUT_FILE_NAME)
  : null;

function processFile(file, next) {
  fs.readFile(file, { encoding: 'utf8' }, function onFileRead(error, content) {
    if (error) {
      next(error);
      return;
    }

    const contentString = content.toString();

    const todosForFile = leasot.parse({
      ext: path.extname(file),
      content: contentString,
      fileName: file,
      customTags: TAGS,
    });

    const isInTests = path.basename(path.dirname(file)).indexOf('test') === 0;

    if (isInTests) {
      const contentStringLines = contentString.split('\n');
      contentStringLines.forEach((line) => {
        const skippedTestRegexp = /\bit\.skip\((['"])(.+)(\1),.*$/;
        const skippedTestMatch = skippedTestRegexp.exec(line);
        if (skippedTestMatch) {
          const todoEnableSkippedTest = {
            file: file,
            line: 0,
            kind: 'TODO',
            ref: '@' + TEAM_USERNAME,
            text: 'Enable skipped test: ' + skippedTestMatch[2].replace(/\\(.)/g, '$1'),
          };
          todosForFile.push(todoEnableSkippedTest);
        }
      });
    }

    next(null, todosForFile);
  });
}

function strcmp(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function multicmp(cmpArray) {
  for (let ic = cmpArray.length, i = 0; i < ic; ++i) {
    if (cmpArray[i] !== 0) {
      return cmpArray[i];
    }
  }
  return 0;
}

function compareTodos(left, right) {
  const kindcmpres = TAGS.indexOf(left.kind) - TAGS.indexOf(right.kind);
  const filecmpres = strcmp(left.file, right.file);
  const linecmpres = left.line - right.line;
  const refcmpres = strcmp(left.ref, right.ref);
  const textcmpres = strcmp(left.text, right.text);

  const cmpArray = [kindcmpres, filecmpres, linecmpres, refcmpres, textcmpres];

  const multicmpres = multicmp(cmpArray);

  return multicmpres;
}

function processAllFiles(files, next) {
  const todosAll = [];

  function nextFile(fileIndex) {
    if (fileIndex >= files.length) {
      todosAll.sort(compareTodos);
      next(null, todosAll);
      return;
    }

    processFile(files[fileIndex], function onFileProcessed(error, todosForFile) {
      if (error) {
        next(error);
        return;
      }

      if (todosForFile) {
        todosAll.push.apply(todosAll, todosForFile);
      }

      nextFile(fileIndex + 1);
    });
  }

  nextFile(0);
}

function generateMarkdown(todosArray, next) {
  // NOTE(@sompylasar): Disable frequently changing pieces as they cause too many merge conflicts.
  const todosCountEnabled = false;
  const todosByTagCountEnabled = false;
  const lineNumbersEnabled = false;

  const todosMarkdown =
    todosArray.length <= 0
      ? '_Congratulations, the code is clean of TODOs!_'
      : todosArray
          .map(function onMapItem(item) {
            /*
              item ~ {
                file: '/absolute/path/to/file.js',
                kind: 'TODO',
                line: 2,
                text: 'Make this work with `foo-bar`.',
                ref: '@sompylasar'
              }
            */

            const text = item.text.replace(/^\s+|\s+$/g, '');

            const usernames = item.ref
              .split(/[&|,;]+/g)
              .map(function onUsernameTrim(username) {
                username = username.replace(/(^\s+)|(\s+$)/g, '');
                if (username === 'any') {
                  username = TEAM_USERNAME;
                }
                return username;
              })
              .filter(function onUsernameFilter(username) {
                return !!username;
              });

            const fileRelative = path.relative(ROOT_DIR, item.file);
            const fileRelativeUrl = fileRelative + (lineNumbersEnabled ? '#L' + item.line : '');

            const line =
              // NOTE(@sompylasar): We can use '1.' on each line for an ordered list, it's autonumerated in GitHub Markdown viewer.
              ' 1. ' +
              '**' +
              item.kind.toUpperCase() +
              '**' +
              ' ' +
              usernames
                .map(function onUsernameToMarkdown(username) {
                  if (/\s+/.test(username) || username.indexOf('@') > 0 || username.indexOf('+') >= 0) {
                    return '**' + username + '**';
                  }
                  return (
                    '[**' +
                    '@' +
                    username.replace(/^[@]+/, '') +
                    '**](https://github.com/' +
                    username.replace(/^[@]+/, '') +
                    ')'
                  );
                })
                .join(';') +
              ': ' +
              (text || '_(no comment)_') +
              '  \n' +
              '<sup>– [' +
              fileRelativeUrl +
              '](' +
              REPO_BASE_URL +
              fileRelativeUrl +
              ')</sup>';

            return line;
          })
          .join('\n');

  const todosMarkdownWithHeading = [
    '# TODOs',
    '',
    '> <sup>**Warning**: This file is auto-generated.</sup>',
    '',
    '_' +
      (todosCountEnabled ? 'Found ' + todosArray.length : 'Found') +
      ' in `' +
      GLOB +
      '`, looked for ' +
      TAGS.map(function onMapTag(tag) {
        const todosByTagCount = todosArray.filter(function onFilterByTag(item) {
          return item.kind.toUpperCase() === tag.toUpperCase();
        }).length;
        return '`' + tag.toUpperCase() + '`' + (todosByTagCountEnabled ? ' (' + todosByTagCount + ')' : '');
      }).join(', ') +
      '._',
    '',
    todosMarkdown,
    '',
  ].join('\n');

  next(null, todosMarkdownWithHeading);
}

function log(line) {
  process.stderr.write(line + '\n');
}

glob(
  GLOB,
  {
    cwd: ROOT_DIR,
    nodir: true,
    realpath: true,
    ignore: GLOB_IGNORE,
  },
  function onGlob(globError, filesFromGlob) {
    if (globError) {
      handleError(globError);
      return;
    }

    const files = filesFromGlob.filter(function onFilesFilter(file) {
      const relativePath = path.relative(ROOT_DIR, file);
      return !IGNORE_RELATIVE_PATH_RE.test(relativePath) && leasot.isExtSupported(path.extname(relativePath));
    });

    log('Files found: ' + files.length);

    processAllFiles(files, function onAllFilesProcessed(processAllFilesError, todosArray) {
      if (processAllFilesError) {
        handleError(processAllFilesError);
        return;
      }

      log('TODOs found: ' + todosArray.length);

      generateMarkdown(todosArray, function onMarkdownGenerated(generateMarkdownError, todosMarkdown) {
        if (generateMarkdownError) {
          handleError(generateMarkdownError);
          return;
        }

        log('Markdown generated.');

        if (OUTPUT_FILE_PATH) {
          fs.writeFile(OUTPUT_FILE_PATH, todosMarkdown, { encoding: 'utf8' }, function onFileWritten(writeFileError) {
            if (writeFileError) {
              handleError(writeFileError);
              return;
            }

            log('Markdown written to file: ' + OUTPUT_FILE_PATH);

            if (!argv['skip-git']) {
              gitAdd(OUTPUT_FILE_PATH, function onGitAdded(gitAddError) {
                if (gitAddError) {
                  handleError(gitAddError);
                  return;
                }

                log('File added to git stage: ' + OUTPUT_FILE_PATH);
              });
            }
          });
        } else {
          process.stdout.write(todosMarkdown);
          log('Markdown written to stdout.');
        }
      });
    });
  },
);
