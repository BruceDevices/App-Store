#!/usr/bin/env node

import * as babel from '@babel/core';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function renameCatchVariablesPlugin() {
  let counter = 0;

  return {
    name: 'rename-catch-variables',
    visitor: {
      CatchClause(path) {
        const param = path.node.param;
        if (!param || param.type !== 'Identifier') return;

        const oldName = param.name;
        const newName = `_c${counter++}`;
        path.scope.rename(oldName, newName);
      }
    }
  };
}

function processMinifiedFile(inputPath, outputPath) {
  console.log(`Processing minified file: ${inputPath}`);
  
  try {
    // Read the minified file
    const code = readFileSync(inputPath, 'utf8');
    
    // Transform the code
    const result = babel.transformSync(code, {
      babelrc: false,
      configFile: false,
      plugins: [renameCatchVariablesPlugin],
      parserOpts: {
        allowReturnOutsideFunction: true,
        sourceType: 'script'
      },
    });

    if (!result || !result.code) {
      throw new Error('Babel transformation failed');
    }

    // Write the processed file
    writeFileSync(outputPath, result.code, 'utf8');
    
    console.log(`Catch variables renamed successfully!`);
    console.log(`Output saved to: ${outputPath}`);
    
    return true;
  } catch (error) {
    console.error('Error processing minified file:', error.message);
    return false;
  }
}

// Main execution
const inputFile = join(__dirname, '../../minified/App Store.js');
const outputFile = join(__dirname, '../../minified/App Store.js');

const success = processMinifiedFile(inputFile, outputFile);
process.exit(success ? 0 : 1);