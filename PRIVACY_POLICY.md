# Privacy Policy for Xray

Effective date: 2026-03-23

Xray is a Chrome extension that helps users inspect elements on the current web page and continue that inspection in a DevTools panel.

## Summary

Xray does not sell personal data, does not use inspected data for advertising, and does not send inspected page data to external servers as part of its current functionality.

Xray handles limited page data locally on the user's device so it can provide its inspection features.

## What Xray Accesses

When the user explicitly activates Xray on a tab, the extension may access limited information from the current page, including:

- element tag names, classes, IDs, selectors, and layout information
- computed visual and box model information
- limited element metadata needed to show inspection results
- reduced page context needed to reopen or continue inspection in the DevTools panel

If the user chooses to inspect a form control, Xray may temporarily read the element state needed to display inspection results. Xray is designed not to persist sensitive form values such as password contents.

## What Xray Stores

Xray stores data locally in Chrome storage on the user's device for the following purposes:

- extension preferences such as sidebar width, sidebar position, and DevTools state
- temporary reduced inspection context used to hand off the current inspection to the DevTools panel
- temporary per-tab state used to manage refresh and reopen behavior

Xray does not intentionally persist full inspected page text, arbitrary data attributes, image URLs, or full page titles for its local DevTools handoff storage.

## How Xray Uses Data

Xray uses accessed data only to provide the extension's user-facing inspection features, including:

- showing inspection results in the in-page sidebar
- reopening or continuing an inspection inside the Xray DevTools panel
- copying CSS or selector information when the user requests it
- downloading an inspected image only when the user explicitly requests a download

## Data Sharing

Xray does not sell, rent, or transfer inspected page data to data brokers, advertisers, analytics vendors, or other third parties.

Xray does not send inspected page data to remote servers as part of its current functionality.

Chrome may process extension installation, updates, crash reporting, or download handling according to Chrome's own policies. That processing is outside Xray's direct control.

## Remote Code

Xray does not load or execute remotely hosted code.

## User Control

The user controls when Xray runs:

- Xray activates when the user clicks the extension action
- Xray inspection can be turned off by closing the sidebar or disabling capture
- DevTools integration can be toggled from the extension UI
- temporary inspection state is cleared on tab reload, tab removal, extension startup, and extension install/update events where applicable

## Security

Xray is designed to minimize stored data and request only the permissions needed for its inspection workflow.

## Changes to This Policy

If Xray's data practices change, this policy should be updated before or at the same time as the product change is released.

## Contact

For questions about this privacy policy, contact:

- Email: `nibin.lab.99@gmail.com`
- Support URL: `https://nibin-portfolio.vercel.app/`
