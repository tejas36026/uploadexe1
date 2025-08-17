// sign.js
const { sign } = require('@electron/sign'); // Corrected package name
const path = require('path');

exports.default = async function (context) {
  const { electronPlatformName, appOutDir } = context;
  const appName = context.packager.appInfo.productFilename;

  // We only want to sign the Windows .exe
  if (electronPlatformName !== 'win32') {
    return;
  }

  console.log('  • Signing application using @electron/sign with Sigstore...');

  // Get the path to the built .exe file
  const appPath = path.join(appOutDir, `${appName}.exe`);

  // Sign it!
  try {
    await sign({
      appPath: appPath,
    });
    console.log(`  • Successfully signed ${appName}.exe`);
  } catch (error) {
    console.error('  ⨯ Signing failed:', error);
    // Optional: Fail the build if signing fails
    // throw error; 
  }
};