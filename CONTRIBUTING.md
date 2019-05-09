# Contributing

## Coding Conventions

Nothing too rigid: just start reading the code and you'll get the hang of it. In general, readability and conciseness is strongly prefered over verbosity. Some few minor religious points:

  * Indent using four spaces!
  * Spaces after list items and method parameters ([1, 2, 3], not [1,2,3]), around operators (x += 1, not x+=1), and around hash arrows.
  * Comment with thought, chose names very carefully.
  * Consistency is king.

There's currently no linting or enforced coding style, but that might change: open to suggestions on best practics and improvements.

## Known Issues / FIXMEs

  * Global namespace usage could definitely be improved: the current setup works, but doesn't feel great.
  * TypeScript (?!)

## Submitting a Patch

Please start by opening a new issue describing the bug or feature you're intending to fix, and mention in the initial issue that you are planning to work on that bug or feature so that it can be assigned to you.

Follow the normal process of forking the project, and setup a new branch to work in. It's important that each group of changes be done in separate branches in order to ensure that a pull request only includes the commits related to that bug or feature.

Do your best to have well-formed commit messages for each change. This provides consistency throughout the project, and ensures that commit messages are able to be formatted properly by various git tools.

Finally, push the commits to your fork and submit a pull request.

## Copyright 

Please do not contribute unless you are willing to assign, waive or irrevocably grant to us the copyright of your contribution: to be able to realistically enforce the terms of the AGPL license, copyright needs to reside with a single person or entity. See [here](https://www.gnu.org/licenses/why-assign.en.html) and [here](https://producingoss.com/en/copyright-assignment.html) for more information.
