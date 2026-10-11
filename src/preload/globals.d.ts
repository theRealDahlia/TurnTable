/** The one browser global the preload reads; declared narrowly so main-process code doesn't get the whole DOM. */
declare const location: { readonly pathname: string }
