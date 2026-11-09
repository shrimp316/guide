export function parsePostRoute(hash) {
  const [page, query = ''] = hash.replace(/^#/, '').split('?');
  const postId = new URLSearchParams(query).get('post');
  // Firestore document IDs cannot contain slashes.
  return { page: page || 'home', postId: postId && !postId.includes('/') ? postId : null };
}

export function buildPostLink(href, postId) {
  const url = new URL(href);
  url.search = '';
  url.hash = `guide-all?${new URLSearchParams({ post: postId })}`;
  return url.href;
}

export async function copyPostLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Clipboard permissions may be unavailable in embedded browsers or over HTTP.
    window.prompt('아래 공유 링크를 복사해주세요.', url);
    return false;
  }
}
