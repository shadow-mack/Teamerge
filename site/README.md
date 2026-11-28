# Teamerge site

The landing page is plain static HTML in `public/`, with no build step.

- **Preview:** open `public/index.html` in a browser.
- **Deploy to GitHub Pages:** in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**,
  then run the **Deploy site** workflow from the **Actions** tab. It only runs when started by hand.
- **Deploy anywhere else:** upload the contents of `public/` to any static host (Cloudflare Pages, Netlify,
  Vercel).

The download button links to the latest GitHub release, so publishing a release updates it without
touching the site.
