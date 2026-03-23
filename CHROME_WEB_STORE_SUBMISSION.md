# Chrome Web Store Submission Copy

This file contains paste-ready copy for the Chrome Web Store listing and Privacy practices tab for Xray.

## Title

Xray

## Summary

Inspect page elements instantly with an in-page sidebar and DevTools panel for DOM, styles, layout, attributes, and box model details.

## Category

Developer Tools

## Detailed Description

Xray helps you inspect page elements without leaving the page you are working on.

Click the Xray toolbar button, then select any element to open a focused inspection sidebar with:

- DOM identity details
- selector and useful attributes
- computed visual styles
- layout and parent layout clues
- box model values
- CSS snippet copy
- image download for inspected images
- DevTools integration for continuing inspection inside Chrome DevTools

Xray is designed for front-end debugging, UI review, and quick page inspection workflows.

What Xray does:

- opens an in-page sidebar only when you activate it
- lets you inspect the current page by clicking an element
- shows element metadata, styles, spacing, and layout information
- stores only limited local state needed for the active inspection workflow
- can reopen inspection context inside the Xray DevTools panel

What Xray does not do:

- it does not run on every page automatically
- it does not inject remote code
- it does not send inspected page data to external servers
- it does not sell or transfer collected data to third parties

## Single Purpose Description

Xray lets users inspect elements on the current page and view DOM, style, layout, and box model details in an in-page sidebar and DevTools panel.

## Suggested Screenshots

- Xray sidebar inspecting a button or card on a live page
- DevTools panel showing the same inspected element
- settings view showing capture and DevTools controls
- box model visualization

## Privacy Practices Tab

The items below are written to match the current codebase.

### Permissions Justification

`activeTab`
Used to activate Xray on the tab the user explicitly clicks from the toolbar.

`scripting`
Used to inject the Xray content script and stylesheet into the active tab after the user activates the extension.

`storage`
Used to save local Xray preferences such as sidebar width, sidebar position, DevTools toggle state, and limited local inspection context needed for the active workflow.

`downloads`
Used only when the user explicitly clicks the image download action for an inspected image.

### Remote Code

No, this extension does not use or execute remote code.

### Data Usage

Recommended disclosure based on the current implementation:

- Collected data type: `Website content`
- Purpose: user-facing element inspection on the active page
- Data handling: stored locally on the user's device in reduced form only when needed for the inspection workflow
- Data sharing: not shared with third parties
- Data sale: not sold
- Data use for advertising: not used for advertising or marketing
- Creditworthiness or lending: not used to determine creditworthiness or for lending purposes

Notes:

- This recommendation is an inference from the current code and should be checked against the exact labels shown in the current Chrome Web Store dashboard.
- The extension inspects current page content chosen by the user and keeps limited local state so the inspection can continue in the DevTools panel.
- The extension does not transmit inspected data to external services.

## Listing Notes

- Keep the store listing accurate and narrow. Chrome requires listing metadata to be up to date and consistent with the product behavior.
- Make sure the Privacy practices tab matches both the listing and the privacy policy.
- Publish the privacy policy at a stable public URL and paste that URL into the Web Store dashboard.

## Official References

- Chrome Web Store listing requirements: https://developer.chrome.com/docs/webstore/program-policies/listing-requirements/
- Privacy practices tab guidance: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/
- Chrome Web Store privacy policy requirement: https://developer.chrome.com/docs/webstore/program-policies/privacy/
- Limited use policy: https://developer.chrome.com/docs/webstore/program-policies/limited-use/
