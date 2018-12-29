#!/usr/bin/env node

const printUsageAndExit = require('../src/utils').printUsageAndExit;

const toolName = process.argv.slice(2)[0];
if (toolName === '--help' || !/^[a-z0-9-_.]+$/i.test(toolName)) {
  printUsageAndExit(
    'Run a tool from the toolbox.',
    '<tool-name>',
    '[tool-arg]...',
    [['--help', 'This help.']],
    ['js-complex', 'todo --write', '--help'],
  );
}

// TODO(@sompylasar): A `--list` option to see all commands.

const toolModuleRequest = '../src/tasks/' + toolName + '.js';
try {
  require.resolve(toolModuleRequest);
} catch (ex) {
  process.stderr.write('Tool not found: ' + toolName + '\n');
  // eslint-disable-next-line no-process-exit
  process.exit(2);
}

// Remove the tool name from the command line arguments:
process.argv.splice(2, 1);

// Run the tool as if it was called directly:
require(toolModuleRequest);
