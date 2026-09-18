/**
 * Makes relative academy asset URLs resolve under /hilfe/academy even when the
 * document is opened without a trailing slash.
 */
export const prepareHandbookHtml = (
  html: string,
  baseHref: string,
): string => {
  if (html.includes("<base ")) return html;
  return html.replace("<head>", `<head>\n<base href="${baseHref}">`);
};
