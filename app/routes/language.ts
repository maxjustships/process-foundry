import { redirect, type ActionFunctionArgs } from "react-router";
import { isLocale, localeCookie, safeReturnTarget } from "../lib/i18n";
import { requireMutationOrigin } from "../lib/request.server";

export async function action({ request }: ActionFunctionArgs) {
  requireMutationOrigin(request);
  const form = await request.formData();
  const locale = form.get("locale");
  const returnTo = safeReturnTarget(form.get("returnTo"));
  if (!isLocale(locale)) throw redirect(returnTo);
  throw redirect(returnTo, {
    headers: { "Set-Cookie": localeCookie(locale, request) },
  });
}
