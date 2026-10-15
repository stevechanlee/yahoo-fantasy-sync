# Publish the homepage and privacy policy

This guide uses the existing `stevechanlee/yahoo-fantasy-sync` repository. The website is plain HTML/CSS in `docs/`. It has no build step, JavaScript, analytics, credential entry, or application backend. It does not publish the Node application, local state, or fantasy data. Only `docs/` is the Pages publishing source.

These are the default public URLs **after the approved commit is pushed and GitHub Pages is enabled**:

| Purpose | URL |
| --- | --- |
| Application homepage | `https://stevechanlee.github.io/yahoo-fantasy-sync/` |
| Privacy policy | `https://stevechanlee.github.io/yahoo-fantasy-sync/privacy.html` |

Before deployment, these URLs may return 404. A local commit alone does not publish them. No custom domain is configured by these changes.

## 1. Review, approve, and push

Review `docs/index.html`, `docs/privacy.html`, and `docs/assets/`. Confirm the policy matches the app's current handling of Google data. The site contains generic product information, not league names, league IDs, spreadsheet IDs, credentials, or tokens.

After you approve the exact commit, push it to the existing `origin/main`. The requested approval before pushing still applies; this guide does not grant approval automatically.

## 2. Enable GitHub Pages

1. Open [the existing repository's Pages settings](https://github.com/stevechanlee/yahoo-fantasy-sync/settings/pages).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/docs**, then **Save**. Do not select the repository root or publish local build/state directories.
4. Wait for the Pages build/deployment to finish. Follow the deployment link in Settings → Pages or inspect the **pages build and deployment** run in the repository's Actions tab.
5. Confirm **Enforce HTTPS** is enabled when available. The default `github.io` address supports HTTPS.

No new repository or custom GitHub Actions workflow is needed. The committed `docs/.nojekyll` keeps the site as plain static files. Later approved changes pushed to `main` update the site through the same branch publishing source.

Reference: [GitHub: configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## 3. Check the public pages

Open both URLs in a private/incognito browser window. Confirm they load without sign-in, the homepage visibly links to the privacy policy, the policy links back home, styles load, and the mobile layout is readable.

You can also check HTTP responses:

```bash
curl -fI https://stevechanlee.github.io/yahoo-fantasy-sync/
curl -fI https://stevechanlee.github.io/yahoo-fantasy-sync/privacy.html
```

Both should return success over HTTPS. If they return 404, inspect the deployment and check that the Pages source is `main` → `/docs`, that the files have been pushed, and that the URL includes `/yahoo-fantasy-sync/`.

For a local preview before pushing, run from the repository:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Visit `http://127.0.0.1:8000/` and `/privacy.html`, then press Ctrl+C to stop. Serve only `docs/`, rather than the repository root, so local credentials and state are outside the served directory.

## 4. Update Google OAuth branding

Once both pages are publicly accessible, open your existing project in [Google Cloud Console → Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding).

- Use **Yahoo Fantasy Sync** as the app's display name so it matches the website.
- Keep the correct support email and developer contact email in Google Cloud; do not add those private values to this repository.
- Set **Application home page** to `https://stevechanlee.github.io/yahoo-fantasy-sync/`.
- Set **Application privacy policy link** to `https://stevechanlee.github.io/yahoo-fantasy-sync/privacy.html`.
- If an authorized domain is requested, the hostname used here is `stevechanlee.github.io`, with no protocol or path. Follow the ownership instructions below if Google asks for proof or rejects it. Do not claim ownership of `github.io` or `github.com`.
- In **Data Access**, declare the scope the implementation actually requests: `https://www.googleapis.com/auth/spreadsheets`. This is a **sensitive** scope. The current code does not request general Drive scopes. Enabling an API in the Cloud project is different from requesting its OAuth scopes.
- Keep the existing **Desktop app** client. The public site is informational and is not an OAuth callback server. The app continues using a temporary loopback callback on the user's computer.

Google may save changes as draft branding. Follow its available **Verify Branding** / **Publish branding** controls, and check Audience/publishing status and Verification Center separately. A published website does not itself publish or verify the OAuth app. Brand/domain verification and sensitive-scope review are separate checks; follow the requirements Google actually presents for this project. This website is preparation for that process, not a guarantee of approval.

Google documents exceptions for limited personal use; changing the app to production and completing a public-app review are not identical steps. If Google presents a verification requirement, supply the requested ownership and scope-use information without claiming the application is read-only for Google Sheets: it writes its output sheets.

References: [Google brand verification and personal-use exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification), [Sheets scope classifications](https://developers.google.com/workspace/sheets/api/scopes).

## 5. Verify ownership if Google asks

### Proving control of the project website

1. Sign in to [Google Search Console](https://search.google.com/search-console) using a Google account associated with the Cloud project as an Owner or Editor.
2. Add a **URL-prefix** property for the exact website URL: `https://stevechanlee.github.io/yahoo-fantasy-sync/`. Do not choose a DNS Domain property for `github.io`; you do not control its DNS.
3. Choose **HTML tag** verification. Copy the exact `<meta name="google-site-verification" ...>` tag Google supplies into the `<head>` of `docs/index.html`. Do not invent a verification value.
4. Review, commit, and publish that change through the same approval process. Once live, confirm the exact tag is visible in the homepage's HTML source and click **Verify** in Search Console.
5. Leave the tag in place so Google can recheck ownership. This verification value is designed to be public; it is not an OAuth access token, refresh token, client secret, or password. Never put those credentials in a verification tag or file.

If Search Console offers HTML-file verification instead, place its exact supplied file in `docs/`, publish it, and confirm it is reachable at the precise URL Google specifies. If Google requires a URL at the hostname root that this project site cannot serve, do not put the file at a different path and expect it to work.

**Important distinction:** verifying a URL-prefix property for this project proves control of that project URL. It does not prove control of the parent hostname root or DNS. Google OAuth brand verification asks for the relevant top private domain. A project URL-prefix verification may not satisfy that separate requirement. Do not treat a Search Console success for the project path as confirmation that the OAuth authorized-domain requirement has been satisfied.

### If Google requires domain ownership that the project URL cannot prove

Use a custom domain you own, hosted from this **same existing repository**, if Google's verification process requires it. You do not need another repository, and no domain needs to be purchased or changed until that requirement is clear.

1. Choose a hostname on your own domain, for example `sync.example.com`.
2. Verify the domain in Search Console using the DNS TXT record Google provides, following the instructions from your DNS provider. Use a Google account associated with the Cloud project. You cannot perform this DNS step for GitHub's shared domain.
3. Follow [GitHub's custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site). Configure the selected hostname in this repository's Pages settings and the required DNS record. For a subdomain, GitHub generally specifies a CNAME pointing to `stevechanlee.github.io`, not to a project path. Follow the current instructions for your chosen hostname and verify domain ownership in GitHub when applicable.
4. A branch-published site's `docs/CNAME` should contain the actual chosen hostname only, once you configure it. This project intentionally does not include a placeholder CNAME.
5. Wait for DNS and the HTTPS certificate, then enforce HTTPS and confirm the website and policy work on the custom domain.
6. Update the canonical URLs in both HTML files and the URLs in Google Cloud. On the custom hostname the usual homepage and policy paths are `/` and `/privacy.html`; test the actual deployed addresses. Add the domain component Google requests to Authorized domains, such as `example.com` for `sync.example.com`.
7. Complete Google's brand/domain verification and any required data-access review. Keep both website pages on the same domain.

References: [Google's authorized-domain requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification#authorized-domains), [Search Console verification methods](https://support.google.com/webmasters/answer/9008080).

## Keep the policy accurate

The policy describes the current installed Desktop application: Google Sheets scope, local JSON tokens, local snapshots/state, direct calls to Yahoo/Google, dedicated spreadsheet outputs, and no application-operated remote data collection service. Revisit it before changing scopes, introducing a backend, adding analytics, changing storage/retention/sharing, or automatically sending data to another service. Notify users and obtain any required additional consent before a new use of Google data.

The GitHub Pages site itself must remain generic. Do not copy `.env`, OAuth JSON, `.state`, snapshots, real spreadsheet URLs, private support details, or other local data into `docs/`. `.gitignore` cannot prevent exposure if private content is manually copied into a public HTML file.
