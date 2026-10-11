# TurnTable — development rules

## Test and fix after every change

After implementing a feature or editing code, test it for bugs, errors, and code smell, and fix everything found before moving on to the next task.

## Work through lists one item at a time

When given a list of features or tasks:

1. Implement the items individually, in order.
2. Test the current item for bugs, errors, and code smell, and fix any issues.
3. Start the next item only once the current item's tests pass.

Example: given 2 features and 1 task, build feature 1, test and fix it until it passes, then feature 2, then the task. Never batch items or skip ahead on a failing test.

## Commit and push each finished feature

After each feature is added and its tests pass, commit it and push it to the GitHub repo TurnTable.
