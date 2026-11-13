// Working name. Swap the string when the real name lands; nothing else references it.
export const BRAND_NAME = 'Intelinside'
/** The site's domain, shown in the card wordmark. A placeholder until one is registered (Sep 4, 2026). */
export const SITE_DOMAIN = 'intelinside.ai'
/** The site's own repo, public from launch. Results and the catalog both grow by pull request against it. */
export const REPO = 'labscommunity/intelinside'
export const REPO_URL = `https://github.com/${REPO}`
/** Where result files live: `results/<handle>/<name>.json`. */
export const RESULTS_DIR_URL = `${REPO_URL}/tree/main/results`
/** The hardware, model, and runtime catalog. A part gets onto the site by a pull request here. */
export const CATALOG_DIR_URL = `${REPO_URL}/tree/main/frontend/src/catalog`
export const CASCADIA_URL = 'https://cascadia.to/'

/** The company behind the site. Named in the Terms and the Privacy Policy, and nowhere else. */
export const LEGAL_ENTITY = 'Not Community Labs Inc.'
export const LEGAL_ADDRESS = '344 Grove St #4038, Jersey City, NJ 07302'
export const LEGAL_EMAIL = 'team@communitylabs.com'
/** Shown at the top of each legal page. Change it whenever the page's text changes. */
export const TERMS_UPDATED = 'September 7, 2026'
export const PRIVACY_UPDATED = 'September 7, 2026'
