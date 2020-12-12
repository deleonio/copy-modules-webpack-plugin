/*
 * Copyright 2017-present Sonatype, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * A Webpack plugin that copies the raw source of all imported modules to a separate directory, enabling
 * external analysis of _just_ the files that get included in the bundles.  Within the destination folder,
 * modules are laid out in a subdirectory structure matching the original files' relative location to the
 * directory in which webpack runs.  Note that any source files whose relative path is outside of the current directory
 * will have the `..` parts of its path replaced with `__..__` when copied into the destination tree.
 */
/* global Promise */
module.exports = class WebpackCopyModulesPlugin {
  constructor(options) {
    // this.destination is the absolute path to the destination folder
    this.destination = path.resolve(process.cwd(), options.destination);
    this.includePackageJsons = !!options.includePackageJsons;
  }

  apply(compiler) {
    compiler.hooks.emit.tapPromise('WebpackCopyModulesPlugin', this.handleEmit.bind(this));
  }

  handleEmit(compilation) {
    const me = this,
        fileDependencies = new Set();

    compilation.modules.forEach(module => {
      if (typeof module === 'object' && module !== null &&
        typeof module.buildInfo === 'object' && module.buildInfo !== null &&
        typeof module.buildInfo.snapshot === 'object' && module.buildInfo.snapshot !== null
      ) {
        (module.buildInfo.snapshot.managedFiles ||[])
          .forEach(fileDependencies.add.bind(fileDependencies));
      }
    });

    const packageJsons = this.includePackageJsons ? this.findPackageJsonPaths(fileDependencies) : [];

    return Promise.all([...fileDependencies, ...packageJsons].map(function(file) {
      const relativePath = replaceParentDirReferences(path.relative(process.cwd(), file)),
          destPath = path.join(me.destination, relativePath),
          destDir = path.dirname(destPath);

      return fs.pathExists(file)
          .then(exists => exists ?
            fs.mkdirs(destDir).then(() => fs.copy(file, destPath, { overwrite: false })) :
            Promise.resolve()
          );
    }));
  }

  findPackageJsonPaths(filePaths) {
    const packageJsons = new Set(),

        // dirs for which a package.json search has already been conducted.
        // If the package.json search algo ends up in one of these dirs it knows it can stop searching
        dirsAlreadySearchedForPackageJson = new Set();

    // find associated package.json files for each fileDependency
    filePaths.forEach(function(file) {
      let dirPath = path.dirname(file),
          oldDirPath;

      // until we reach the root
      while (dirPath !== oldDirPath) {
        if (dirsAlreadySearchedForPackageJson.has(dirPath)) {
          return;
        }
        else {
          dirsAlreadySearchedForPackageJson.add(dirPath);

          const packageJsonPath = path.join(dirPath, 'package.json');

          if (fs.pathExistsSync(packageJsonPath)) {
            packageJsons.add(packageJsonPath);
            return;
          }
          else {
            // loop again to check next parent dir
            oldDirPath = dirPath;
            dirPath = path.dirname(dirPath);
          }
        }
      }
    });

    return packageJsons;
  }
};

/**
 * Go through the path and replace all `..` parts with `__..__`
 */
function replaceParentDirReferences(inputPath) {
  const pathParts = inputPath.split(path.sep);

  return pathParts.map(part => part === '..' ? '__..__' : part).join(path.sep);
}
