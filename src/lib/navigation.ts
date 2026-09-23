import { router, type Href } from 'expo-router';

/**
 * Back, or somewhere sensible when there is no back.
 *
 * A screen opened straight from a URL — a reload on the web, a deep link — has
 * no history, and `router.back()` then does nothing at all: the Save button
 * saves and the screen just sits there.
 */
export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
