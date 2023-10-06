const { execSync } = require('child_process');
const os = require('os');

// Run the Pandoc command and capture the HTML output
const pandocCommand = 'echo "# Test" | pandoc -t html';
const pandocOutput = execSync(pandocCommand, { encoding: 'utf-8' });

// Define the expected HTML output
const expectedOutputs = {
  win32: '<p>“# Test”</p>',
  darwin: '<h1 id="test">Test</h1>',
  linux: '<h1 id="test">Test</h1>',
};
const expectedOutput = expectedOutputs[os.platform()]

// Compare the Pandoc output with the expected output
if (pandocOutput.trim() === expectedOutput) {
  console.log('Pandoc output matches the expected HTML output.');
  process.exit(0); // Exit with success code
} else {
  console.error('Pandoc output does not match the expected HTML output.');
  console.error(`Expected: ${expectedOutput}`);
  console.error(`Actual: ${pandocOutput.trim()}`);
  process.exit(1); // Exit with failure code
}
