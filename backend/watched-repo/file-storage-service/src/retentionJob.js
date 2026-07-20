// Demo file for the code analyzer to scan. Intentionally buggy: the
// comparison is flipped, so it keeps recently-modified files as "old" and
// never actually cleans up files past the retention window — disk usage
// grows unbounded.
function cleanupOldFiles(files, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const oldFiles = files.filter((f) => f.mtimeMs > cutoff);
  return oldFiles.map((f) => f.remove());
}

module.exports = { cleanupOldFiles };
