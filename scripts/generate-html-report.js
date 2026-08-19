/**
 * Regenerate the human-readable HTML report from an existing JSON evaluation
 * report, without re-running the suite.
 *
 *   node scripts/generate-html-report.js
 */
const fs = require('fs');
const path = require('path');
const { renderHtmlReport } = require('../utils/htmlReport');

const reportsDir = path.join(__dirname, '..', 'reports');
const jsonFile = path.join(reportsDir, 'evaluation-report.json');
const htmlFile = path.join(reportsDir, 'evaluation-report.html');

if (!fs.existsSync(jsonFile)) {
  console.error(`No JSON report found at ${jsonFile}. Run "npm test" first.`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
fs.writeFileSync(htmlFile, renderHtmlReport(summary));
console.log(`HTML report written to ${htmlFile}`);
