import { useRef, useState } from "react";
import { ArrowLeft, Building2, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { saveMsGraphAccount } from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";
import { startGraphDeviceCodeSignIn } from "@/services/oauth/oauthFlow";
import { assertSafeTenant } from "@/services/microsoft/constants";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";

interface AddMicrosoftAccountProps {
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

export function AddMicrosoftAccount({ onClose, onSuccess, onBack }: AddMicrosoftAccountProps) {
  const addAccount = useAccountStore((s) => s.addAccount);
  const [tenant, setTenant] = useState("organizations");
  const [clientId, setClientId] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const handleSignIn = async () => {
    setError(null);
    setUserCode(null);
    setVerificationUri(null);
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
      const { tokens, userInfo } = await startGraphDeviceCodeSignIn(
        safeTenant,
        trimmedClientId,
        {
          onCode: (prompt) => {
            setUserCode(prompt.userCode);
            setVerificationUri(prompt.verificationUri);
          },
          isCancelled: () => cancelRef.current,
        },
      );
      if (!tokens.refresh_token) {
        throw new Error(
          "Microsoft did not return a refresh token. Confirm offline_access is included in the app's delegated permissions.",
        );
      }
      if (!userInfo.email) {
        throw new Error("Microsoft Graph did not return a mailbox address.");
      }

      const savedId = await saveMsGraphAccount({
        id: crypto.randomUUID(),
        email: userInfo.email,
        displayName: userInfo.name || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: getCurrentUnixTimestamp() + tokens.expires_in,
        oauthClientId: trimmedClientId,
        oauthClientSecret: null,
        oauthTenant: safeTenant,
        oauthRedirectUri: "",
      });

      addAccount({
        id: savedId,
        email: userInfo.email,
        displayName: userInfo.name || null,
        avatarUrl: null,
        isActive: true,
        provider: "msgraph",
      });
      onSuccess();
    } catch (err) {
      if (!cancelRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setUserCode(null);
      setVerificationUri(null);
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
      title="Microsoft 365"
      width="w-full max-w-md"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Building2 size={20} className="text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">Microsoft Graph</h3>
            <p className="text-xs text-text-tertiary">
              Sign in with any work or school mailbox. Enter that organization's tenant and application.
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
        {userCode && (
          <div className="p-3 rounded-md border border-border-primary bg-bg-secondary">
            <p className="text-xs text-text-tertiary">Enter this code in the browser window</p>
            <p className="mt-1 font-mono text-lg tracking-widest text-text-primary">{userCode}</p>
            {verificationUri && (
              <p className="mt-1 text-xs text-text-tertiary break-all">{verificationUri}</p>
            )}
          </div>
        )}

        <p className="text-xs text-text-tertiary">
          Use tenant organizations for a multi-tenant public client, or paste your organization's tenant id.
          Sign-in opens in your browser. Enter the code, then sign in with any Microsoft 365 address.
          The application needs public client flows and delegated Mail.ReadWrite, Mail.Send, User.Read, and offline_access.
          If Microsoft says the app is not allowed to read mail, that application has not been granted the mail permissions.
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
