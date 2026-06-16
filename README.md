# SysAid Activity Quick Time Buttons

A small Tampermonkey userscript that adds quick duration buttons to SysAid Activity entries.

The script uses the existing Start Time in the SysAid Activity editor and calculates the End Time automatically.

## Features

- Adds quick buttons for common durations
- Supports custom hours/minutes
- Uses SysAid's existing Start Time
- Auto-fills End Time through the SysAid date/time picker
- Does not overwrite an existing End Time
- Easy button colour customisation

## Install

1. Install the Tampermonkey browser extension.
2. Open the raw `.user.js` file from this repository.
3. Tampermonkey should detect the script and offer to install it.
4. Edit the `@match` line if your SysAid URL does not use `/spaces/ticket`.

## URL matching

By default, the script uses:

```javascript
// @match        https://*/spaces/ticket*
