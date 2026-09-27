// Which categories a person may open a ticket in from the web.
//
//   staffOnly        — a move-into destination only, never a fresh ticket.
//   integrationOnly  — tickets here can ONLY be opened by an integration
//                      (plan §4.4, e.g. the EFM Music Portal's newsong /
//                      songedit / songremoval); the bot enforces the same
//                      rule for panel buttons.
//
// Used by BOTH the /t/new picker (listing) and openTicketAction (the server
// side), so a crafted form post cannot open one either.
export function isWebOpenableCategory(c: { staffOnly: boolean; integrationOnly: boolean }): boolean {
  return !c.staffOnly && !c.integrationOnly
}
