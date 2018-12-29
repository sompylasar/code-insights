# `code-insights`

A toolbox of CLI tools that analyze web application or Node.js source code and show some stats useful for code health maintenance and refactoring.

The implementation is not robust i.e. sometimes uses a quick-n-dirty `indexOf` or `RegExp` instead of a full AST parser so may potentially give a few false positives on large and complex code base, but it is good enough to get an overview of a code base.

The tools are not split into individual packages, so the dependencies of all the tools have to be installed even if you only need one tool. For now, this is by design, to use common utility functions and reduce extra cost of managing several small packages.

## Usage

Run in a directory of interest via [`npx`](https://www.npmjs.com/package/npx):

```
cd your-project-folder
npx @sompylasar/code-insights <tool-name> [tool-arg]...
```
