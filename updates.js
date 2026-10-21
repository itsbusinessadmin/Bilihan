/* Bilihan — what changed, for the "What's new" notes in Admin.

   Admin pops up the entries from the last 3 days (72 hours) every time it is opened
   or refreshed, newest first, and nothing at all when none are that recent. Add a
   new entry at the top whenever a change ships: `at` is when it went in (ISO time),
   `where` is "Admin" or "Customer page", and the text is written for the shop
   owner, not for developers. Old entries can stay; they simply stop showing. */
window.BILIHAN_UPDATES = [
  {
    at: '2026-10-21T17:05:00Z', where: 'Customer page',
    title: 'New CE Fun Club Store logo',
    text: 'The plate-and-fork logo now appears in the header, footer, home picture, browser tab icon, phone home-screen icon, link previews, order emails and the seller page. A logo uploaded in Appearance still takes its place.'
  },
  {
    at: '2026-10-20T20:50:00Z', where: 'Admin',
    title: 'Coupons tab is locked',
    text: 'Coupons now asks for a lock code before showing or changing coupons. It stays open until the browser tab is closed; tap Lock to lock it again.'
  },
  {
    at: '2026-10-19T18:50:00Z', where: 'Admin',
    title: 'What’s new notes',
    text: 'This popup. It lists the changes from the last 3 days whenever you open or refresh Admin, and does not appear when nothing new has shipped.'
  },
  {
    at: '2026-10-19T18:29:00Z', where: 'Customer page',
    title: 'Promo banner appears cleanly',
    text: 'The promo popup now waits for its picture and appears all at once, instead of showing a lone close button first. It no longer flashes twice for returning visitors.'
  },
  {
    at: '2026-10-19T18:21:00Z', where: 'Admin',
    title: 'Extras shown in order details',
    text: 'Orders → order details now lists every extra the customer chose under each item, with its price (e.g. Extra: Boiled Egg +₱15.00).'
  },
  {
    at: '2026-10-17T15:34:00Z', where: 'Admin',
    title: 'Messages float bottom right',
    text: 'Messages moved out of the sidebar into a chat bubble on every page, with the unread count. Tap it to read and reply; switching pages keeps your conversation open.'
  },
  {
    at: '2026-10-17T15:34:00Z', where: 'Customer page',
    title: 'Chat opens by itself on a reply',
    text: 'When you reply, the customer’s chat opens on its own with the notification sound, without popping up their phone keyboard.'
  },
  {
    at: '2026-10-17T14:37:00Z', where: 'Admin',
    title: 'New Promote tab',
    text: 'Shows your menu as customers see it (logo, name and every visible product) and updates live. The camera copies it as one picture to paste in Messenger or Facebook.'
  },
  {
    at: '2026-10-16T22:27:00Z', where: 'Customer page',
    title: 'Roomier extras list',
    text: 'Extras with − / + buttons now get one row each, name and price on the left and the buttons on the right, so long names no longer squeeze together.'
  },
  {
    at: '2026-10-16T22:23:00Z', where: 'Admin',
    title: 'Camera on the Products page',
    text: 'Copy your product list as an image, the same way as on Orders and Sales.'
  },
  {
    at: '2026-10-16T22:09:00Z', where: 'Admin',
    title: 'Tidier variant editor + extra quantities',
    text: 'Variants are now neat cards with a summary. Set Max qty on an extra and customers can order more than one (e.g. Extra Rice ×2), charged per piece.'
  },
  {
    at: '2026-10-16T21:52:00Z', where: 'Admin',
    title: 'Hidden products in red',
    text: 'Products hidden from customers are highlighted bright red in the Products list.'
  },
  {
    at: '2026-10-16T21:45:00Z', where: 'Admin',
    title: 'Hide or show a product',
    text: 'The eye button beside Edit hides a product from the customer page without deleting it. Tap again to show it.'
  }
];
