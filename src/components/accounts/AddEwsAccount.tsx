import { useRef, useState } from "react";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { saveEwsAccount } from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";
import { startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
import { microsoftEwsProvider } from "@/services/oauth/providers";
import { assertSafeTenant, EWS_HOST_URL, EWS_NATIVE_REDIRECT } from "@/services/microsoft/constants";
import { ewsPing } from "@/services/microsoft/ewsCommands";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";

interface AddEwsAccountProps {
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

export function AddEwsAccount({ onClose, onSuccess, onBack }: AddEwsAccountProps) {
  const addAccount = useAccountStore((s) => s.addAccount);
  const [tenant, setTenant] = useState("organizations");
  const [clientId, setClientId] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const handleSignIn = async () => {
    setError(null);
    const trimmedClientId = clientId.trim();
    if (!trimmedClientId) {
      setError("Enter the application (client) id.");
      return;
    }
    let safeTenant = "";
    try {
      safeTenant = assertSafeTenant(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    cancelRef.current = false;
    setSigningIn(true);
    try {
      const { tokens, userInfo } = await startProviderOAuthFlow(
        microsoftEwsProvider(safeTenant),
        trimmedClientId,
      );
      if (cancelRef.current) throw new Error("Sign-in was cancelled.");
      if (!tokens.refresh_token) {
        throw new Error(
          "Microsoft did not return a refresh token. The application must be a public client that can keep you signed in.",
        );
      }
      if (!userInfo.email) {
        throw new Error("Microsoft did not return a mailbox address.");
      }
      await ewsPing(tokens.access_token, userInfo.email);
      if (cancelRef.current) throw new Error("Sign-in was cancelled.");

      const savedId = await saveEwsAccount({
        id: crypto.randomUUID(),
        email: userInfo.email,
        displayName: userInfo.name || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: getCurrentUnixTimestamp() + tokens.expires_in,
        oauthClientId: trimmedClientId,
        oauthClientSecret: null,
        oauthTenant: safeTenant,
        oauthRedirectUri: EWS_NATIVE_REDIRECT,
      });

      addAccount({
        id: savedId,
        email: userInfo.email,
        displayName: userInfo.name || null,
        avatarUrl: null,
        isActive: true,
        provider: "ews",
      });
      onSuccess();
    } catch (err) {
      if (!cancelRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setSigningIn(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={() => {
        cancelRef.current = true;
        onClose();
      }}
      title="Microsoft Office 365 Legacy (EWS)"
      width="w-full max-w-md"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Mail size={20} className="text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">Exchange Web Services</h3>
            <p className="text-xs text-text-tertiary">
              Sign in with any work or school mailbox when Graph mail is not available. Enter that organization's tenant and application.
            </p>
          </div>
        </div>

        <TextField
          label="Tenant ID"
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <TextField
          label="Application (client) ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-text-tertiary">
          Use tenant organizations for a multi-tenant public client, or paste your organization's tenant id.
          Sign-in opens in a window and returns through the public-client reply address {EWS_NATIVE_REDIRECT}. No client secret is sent.
          Mail is read from {EWS_HOST_URL} with Exchange Web Services, not Microsoft Graph.
          The application needs delegated EWS.AccessAsUser.All on https://outlook.office.com, registered as a mobile and desktop application.
          If Microsoft asks for a client secret, that application is not a public client with that reply address.
          Microsoft is retiring EWS in Exchange Online, so the organization has to still allow it for this application.
        </p>

        {error && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-text-primary" role="alert">
            {error}
          </div>
        )}

        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true;
              if (!signingIn) onBack();
            }}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={14} />
            {signingIn ? "Cancel" : "Back"}
          </button>
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={signingIn || !clientId.trim()}
            className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
          >
            {signingIn && <Loader2 size={14} className="animate-spin" />}
            Sign in with Microsoft
          </button>
        </div>
      </div>
    </Modal>
  );
}
