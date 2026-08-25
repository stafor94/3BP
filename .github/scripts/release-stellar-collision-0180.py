from pathlib import Path

package_path = Path('package.json')
package = package_path.read_text(encoding='utf-8')
old_version = '"version": "0.17.24"'
new_version = '"version": "0.18.0"'
if package.count(old_version) != 1:
    raise RuntimeError(f'expected one package version, found {package.count(old_version)}')
package_path.write_text(package.replace(old_version, new_version, 1), encoding='utf-8')

changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text(encoding='utf-8')
old_heading = '## [Unreleased]\n'
new_heading = '## [0.18.0] - 2026-08-26\n'
if changelog.count(old_heading) != 1:
    raise RuntimeError(f'expected one Unreleased heading, found {changelog.count(old_heading)}')
changelog_path.write_text(changelog.replace(old_heading, new_heading, 1), encoding='utf-8')
