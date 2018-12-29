#!/bin/bash
# Collects the --help output from every command in the "./src/tasks" directory.

echo "## Commands"
echo
echo "\`\`\`"
./bin/cli.js --help 2>&1
echo "\`\`\`"
echo

while read -r name; do
  # Each line is a space-separated pair: "<command-name> <command-script-path>"
  echo "### \`$(echo "$name")\`"
  echo
  echo "\`\`\`"
  ./bin/cli.js "$name" --help 2>&1
  echo "\`\`\`"
  echo
done < <(ls -1 ./src/tasks | sed 's/\.js$//');
