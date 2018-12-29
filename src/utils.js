const ROOT_DIR = process.cwd();

function strcmp(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function strcmpRelativePathDirsBeforeFiles(left, right) {
  const leftIsDir = left.indexOf('/') > 0;
  const rightIsDir = right.indexOf('/') > 0;

  if (leftIsDir === rightIsDir) {
    return strcmp(left, right);
  }

  if (leftIsDir) {
    return -1;
  }

  return 1;
}

function padleft(str, length, character) {
  str = String(str);
  while (str.length < length) {
    str = (character || ' ') + str;
  }
  return str;
}

function padright(str, length, character) {
  str = String(str);
  while (str.length < length) {
    str += character || ' ';
  }
  return str;
}

function padcenter(str, length) {
  let left = true;
  str = String(str);
  while (str.length < length) {
    str = (left ? ' ' : '') + str + (!left ? ' ' : '');
    left = !left;
  }
  return str;
}

function percent(current, total) {
  return '  (' + padleft((total > 0 ? (100 * current) / total : 0).toFixed(2), 6) + '%)';
}

function printUsageAndExit(toolDescription, toolName, toolArgs, toolOptions, toolExamples) {
  const toolOptionsMaxLength = Array.isArray(toolOptions)
    ? toolOptions.reduce((a, x) => Math.max(a, x[0].length), 0)
    : 0;
  const packageName = require('../package.json').name;
  process.stderr.write(
    toolDescription +
      '\n\n' +
      'Usage: npx ' +
      packageName +
      ' ' +
      toolName +
      ' ' +
      toolArgs +
      (Array.isArray(toolOptions) && toolOptions.length > 0
        ? '\n\n' +
          'Options:\n  ' +
          toolOptions.map((x) => padright(x[0], toolOptionsMaxLength) + '  ' + x[1]).join('\n\n  ')
        : '') +
      (Array.isArray(toolExamples) && toolExamples.length > 0
        ? '\n\n' +
          'Examples:\n  ' +
          toolExamples
            .map((x) => 'npx ' + packageName + ' ' + (toolName.indexOf('<') === 0 ? '' : toolName + ' ') + x)
            .join('\n\n  ')
        : '') +
      '\n\n',
  );
  // eslint-disable-next-line no-process-exit
  process.exit(-1);
}

function handleError(error) {
  try {
    const PrettyError = require('pretty-error');
    process.stderr.write(new PrettyError().render(error) + '\n');
  } catch (ex) {
    process.stderr.write(require('util').inspect(error) + '\n');
  }
  // eslint-disable-next-line no-process-exit
  process.exit(-1);
}

function makeHistogramAsciiChart(buckets, options) {
  const rows = [];

  const bucketKeys = Object.keys(buckets).sort(function(left, right) {
    return parseInt(left, 10) - parseInt(right, 10);
  });

  let maxBucketValue = 0;
  let maxBucketValueStringLength = 0;
  let maxLabelLength = 10;
  const labels = [];
  bucketKeys.forEach(function(bucketKey, index) {
    const label =
      bucketKey + (options && options.displayRange && bucketKeys[index + 1] ? '-' + bucketKeys[index + 1] : '');
    const bucketValue = buckets[bucketKey];
    if (bucketValue >= maxBucketValue) {
      maxBucketValue = bucketValue;
    }

    const maxBucketValueString = String(bucketValue);
    if (maxBucketValueString.length > maxBucketValueStringLength) {
      maxBucketValueStringLength = maxBucketValueString.length;
    }

    labels.push(label);
    if (label.length > maxLabelLength) {
      maxLabelLength = label.length;
    }
  });

  const screenWidth = 80;
  const chartScale = (screenWidth - maxBucketValueStringLength - maxLabelLength - 3 - 3) / maxBucketValue;
  const chartWidth = Math.ceil(maxBucketValue * chartScale);

  bucketKeys.forEach(function(bucketKey, index) {
    const bucketValue = buckets[bucketKey];
    const chartValue = bucketValue <= 1 ? 0 : Math.floor(bucketValue * chartScale);

    rows.push({
      label: labels[index],
      bucketValue: bucketValue,
      chartValue: bucketValue >= 10 && chartValue <= 1 ? 1 : chartValue,
    });
  });

  if (options && options.sortByLabel) {
    rows.sort(function(left, right) {
      return strcmp(left.label, right.label);
    });
  }

  const lines = rows.map(function onRow(row) {
    const dotCharacter =
      row.bucketValue > 0
        ? row.bucketValue < 10
          ? Math.ceil(row.bucketValue) === 1
            ? '.'
            : Math.ceil(row.bucketValue)
          : 'o'
        : ' ';
    return (
      padleft(row.label, maxLabelLength) +
      ' | ' +
      padleft(dotCharacter, row.chartValue + 1, '-') +
      padleft('', chartWidth - row.chartValue) +
      ' | ' +
      padleft(row.bucketValue, maxBucketValueStringLength)
    );
  });

  return lines;
}

function gitAdd(file, callback) {
  require('child_process').execFile('git', ['add', file], callback);
}

module.exports = {
  ROOT_DIR: ROOT_DIR,
  strcmp: strcmp,
  strcmpRelativePathDirsBeforeFiles: strcmpRelativePathDirsBeforeFiles,
  padleft: padleft,
  padright: padright,
  padcenter: padcenter,
  percent: percent,
  printUsageAndExit: printUsageAndExit,
  handleError: handleError,
  makeHistogramAsciiChart: makeHistogramAsciiChart,
  gitAdd: gitAdd,
};
