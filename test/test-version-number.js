const { execSync } = require('child_process');
const process = require('process');

// Check if the desired version parameter is provided and only use the 2 first numbers.
const desiredVersion = process.argv[2].split('.').slice(0, 2).join('.');

if (!desiredVersion) {
  console.error('Usage: node check-pandoc-version.js <desired_version>');
  process.exit(1); // Exit with failure code
}

try {
  // Run the "pandoc --version" command and capture the output
  const output = execSync('pandoc --version', { encoding: 'utf-8' });

  // Use regular expressions to extract the first two numbers of the version
  const versionMatch = output.match(/pandoc (\d+\.\d+)/);

  if (versionMatch) {
    const pandocVersion = versionMatch[1].split('.').slice(0, 2).join('.'); // Extract the first two numbers
    if (pandocVersion === desiredVersion) {
      console.log(`Pandoc Version is ${desiredVersion}`);
      process.exit(0); // Exit with success code
    } else {
      console.log(`Pandoc Version is not ${desiredVersion} (Found: ${pandocVersion})`);
      process.exit(1); // Exit with failure code
    }
  } else {
    console.log('Pandoc version not found in the output.');
    process.exit(1); // Exit with failure code
  }
} catch (error) {
  console.error('Error running "pandoc --version"');
  process.exit(1); // Exit with failure code
}
