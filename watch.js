import { watch } from 'fs';
import { exec } from 'child_process';
import path from 'path';

const dirname = process.cwd();
console.log(`Watching directory: ${dirname} for changes...`);

let timeoutId = null;

function runGit() {
  console.log('Changes detected! Preparing to push...');
  // Path to git
  const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe';
  exec(`"${gitPath}" add .`, (err) => {
    if (err) {
      console.error('Error staging changes:', err);
      return;
    }
    exec(`"${gitPath}" commit -m "Auto-commit on change"`, (err, stdout, stderr) => {
      // It might return error 1 if there is nothing to commit, which is fine
      if (stdout.includes('nothing to commit') || stderr.includes('nothing to commit')) {
        console.log('Nothing to commit.');
        return;
      }
      console.log('Committing changes...');
      exec(`"${gitPath}" push origin main`, (err) => {
        if (err) {
          console.error('Error pushing to GitHub:', err);
          return;
        }
        console.log('Successfully pushed to GitHub!');
      });
    });
  });
}

// Watch folder
const watchOptions = { recursive: true };
watch(dirname, watchOptions, (eventType, filename) => {
  if (!filename) return;
  
  // Normalize path separators
  const normalizedFilename = filename.replace(/\\/g, '/');
  
  // Ignore git, node_modules, dist, temp files, and watch.js itself
  if (
    normalizedFilename.includes('.git') ||
    normalizedFilename.includes('node_modules') ||
    normalizedFilename.includes('dist') ||
    normalizedFilename === 'watch.js' ||
    normalizedFilename.endsWith('.log')
  ) {
    return;
  }
  
  console.log(`File changed: ${filename}`);
  if (timeoutId) clearTimeout(timeoutId);
  timeoutId = setTimeout(() => {
    runGit();
  }, 10000); // Wait 10 seconds of inactivity before pushing
});
