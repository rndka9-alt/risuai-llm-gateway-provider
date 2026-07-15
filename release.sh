#!/bin/bash
set -euo pipefail

# 사용법: ./release.sh [patch|minor|major] ["릴리즈 노트"]
# 예시:
#   ./release.sh patch "스트리밍 지원"
#   ./release.sh minor                       ← 노트 없이 (에디터 열림)
#   ./release.sh                              ← patch + 에디터

BUMP="${1:-patch}"
NOTE="${2:-}"

# 최신 태그에서 현재 버전 추출 (없으면 v0.0.0)
CURRENT=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
IFS='.' read -r MAJOR MINOR PATCH <<< "${CURRENT#v}"

# 버전 범프
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  *) echo "사용법: ./release.sh [patch|minor|major] [\"릴리즈 노트\"]"; exit 1 ;;
esac

NEXT="v${MAJOR}.${MINOR}.${PATCH}"
echo "${CURRENT} → ${NEXT} (${BUMP})"

# package.json 버전 업데이트 (빌드가 package.json에서 @version을 읽으므로 먼저 실행)
npm version "${NEXT}" --no-git-tag-version --allow-same-version >/dev/null 2>&1

# 빌드
npm run build
echo "빌드 완료: plugin.min.js"

# 커밋 + 태그
git add plugin.min.js package.json package-lock.json
git commit -m "release: ${NEXT}" --allow-empty
git tag -a "${NEXT}" -m "${NOTE:-${NEXT}}"

# 푸시
git push origin main --tags

# GitHub Release 생성
if [ -n "$NOTE" ]; then
  gh release create "${NEXT}" plugin.min.js --title "${NEXT}" --notes "${NOTE}"
else
  # 노트 없으면 에디터 열림
  gh release create "${NEXT}" plugin.min.js --title "${NEXT}"
fi

echo "릴리즈 완료: ${NEXT}"
echo "다운로드: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/download/${NEXT}/plugin.min.js"
