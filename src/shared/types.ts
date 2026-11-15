// Shared message and data types. Every message shape lives here.

/** Service worker -> side panel: put the cursor in the search box. */
export interface FocusSearchMsg {
  type: 'focus-search';
}

export type Msg = FocusSearchMsg;
