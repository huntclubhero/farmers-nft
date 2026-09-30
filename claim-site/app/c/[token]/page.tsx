"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  createPublicClient,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { publicTransport } from "@/lib/privateRpc";
import { activeChain } from "@/lib/wagmi";
import {
  PROXY_ADDRESS,
  hatPetAbi,
  getWalletClient,
} from "@/lib/contract";
import { decodeTokenURI, type DecodedTokenMetadata } from "@/lib/decode-tokenURI";

type LoadState = "loading" | "ready" | "error";

type Branch =
  | { kind: "invalid" }
  | { kind: "claimed" }
  | { kind: "not_open_yet"; opensAt: number }
  | { kind: "closed" }
  | { kind: "claimable"; spriteId: number };

const TOKEN_HEX_REGEX = /^[0-9a-fA-F]{64}$/;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "any second now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function ClaimPage() {
  const params = useParams<{ token: string }>();
  const rawToken = params?.token || "";

  const { ready: privyReady, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [branch, setBranch] = useState<Branch | null>(null);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [claimStart, setClaimStart] = useState<number | null>(null);
  const [claimEnd, setClaimEnd] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [mintedTokenId, setMintedTokenId] = useState<bigint | null>(null);
  const [metadata, setMetadata] = useState<DecodedTokenMetadata | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isValidToken = useMemo(
    () => TOKEN_HEX_REGEX.test(rawToken),
    [rawToken],
  );

  const tokenHex = useMemo<Hex | null>(() => {
    if (!isValidToken) return null;
    return ("0x" + rawToken.toLowerCase()) as Hex;
  }, [isValidToken, rawToken]);

  const tokenHash = useMemo<Hex | null>(() => {
    if (!tokenHex) return null;
    return keccak256(tokenHex);
  }, [tokenHex]);

  // Tick clock so the "opens in" countdown updates.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Initial state load from chain.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!isValidToken || !tokenHash) {
        setBranch({ kind: "invalid" });
        setLoadState("ready");
        return;
      }
      if (PROXY_ADDRESS === ZERO) {
        setErrorMessage(
          "NEXT_PUBLIC_PROXY_ADDRESS is not set. Configure your .env.local and reload.",
        );
        setLoadState("error");
        return;
      }
      try {
        const client = createPublicClient({
          chain: activeChain,
          transport: publicTransport,
        });
        const [spriteRaw, alreadyClaimed, startRaw, endRaw] = await Promise.all([
          client.readContract({
            address: PROXY_ADDRESS,
            abi: hatPetAbi,
            functionName: "tokenSprite",
            args: [tokenHash],
          }),
          client.readContract({
            address: PROXY_ADDRESS,
            abi: hatPetAbi,
            functionName: "claimedHash",
            args: [tokenHash],
          }),
          client.readContract({
            address: PROXY_ADDRESS,
            abi: hatPetAbi,
            functionName: "claimStart",
            args: [],
          }),
          client.readContract({
            address: PROXY_ADDRESS,
            abi: hatPetAbi,
            functionName: "claimEnd",
            args: [],
          }),
        ]);
        if (cancelled) return;

        const sprite = Number(spriteRaw);
        const start = Number(startRaw);
        const end = Number(endRaw);
        setClaimStart(start);
        setClaimEnd(end);

        const ts = Math.floor(Date.now() / 1000);
        if (sprite === 0) {
          setBranch({ kind: "invalid" });
        } else if (alreadyClaimed) {
          setBranch({ kind: "claimed" });
        } else if (ts < start) {
          setBranch({ kind: "not_open_yet", opensAt: start });
        } else if (ts > end) {
          setBranch({ kind: "closed" });
        } else {
          // sprite is stored as spriteId + 1 in the contract.
          setBranch({ kind: "claimable", spriteId: sprite - 1 });
        }
        setLoadState("ready");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(`Could not read claim state: ${msg}`);
        setLoadState("error");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [isValidToken, tokenHash]);

  // Refresh branch when claimStart/claimEnd cross "now".
  useEffect(() => {
    if (!branch || branch.kind === "invalid" || branch.kind === "claimed") return;
    if (claimStart == null || claimEnd == null) return;
    if (now >= claimStart && branch.kind === "not_open_yet") {
      // Window just opened. Force a re-read on next render path: leave it
      // to the user to click claim; we will recheck eligibility on submit.
    }
    if (now > claimEnd && branch.kind === "claimable") {
      setBranch({ kind: "closed" });
    }
  }, [now, claimStart, claimEnd, branch]);

  const activeWallet = useMemo(() => {
    if (!wallets || wallets.length === 0) return null;
    // Prefer the wallet whose chain matches the active chain.
    const matching = wallets.find(
      (w) => w.chainId === `eip155:${activeChain.id}`,
    );
    return matching || wallets[0];
  }, [wallets]);

  const walletAddress = (activeWallet?.address || null) as Address | null;

  async function handleClaim() {
    if (!tokenHex || !walletAddress || !activeWallet) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      // Switch chain if needed.
      try {
        await activeWallet.switchChain(activeChain.id);
      } catch {
        // Some wallets throw if already on chain; ignore.
      }

      const provider = await activeWallet.getEthereumProvider();
      // Privy's EIP1193Provider type and viem's expected provider have a structural
      // mismatch on the `on` method's event handler union. The runtime shape is
      // compatible (both are standard EIP-1193); we cast at this boundary only.
      const walletClient = getWalletClient(provider as unknown as Parameters<typeof getWalletClient>[0], walletAddress);

      // Build raw tx data so we can use sendTransaction (which routes
      // through our custom transport / private RPC).
      const data = encodeFunctionData({
        abi: hatPetAbi,
        functionName: "claim",
        args: [tokenHex],
      });

      const hash = await walletClient.sendTransaction({
        account: walletAddress,
        chain: activeChain,
        to: PROXY_ADDRESS,
        data,
        value: 0n,
      });
      setTxHash(hash);

      // Wait for inclusion via the public client.
      const publicClient = createPublicClient({
        chain: activeChain,
        transport: publicTransport,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Find the Claimed event for our tokenHash.
      const claimedEvent = (hatPetAbi as readonly unknown[]).find(
        (x) =>
          typeof x === "object" &&
          x !== null &&
          "name" in x &&
          (x as { name?: string }).name === "Claimed",
      );
      // We could decode logs, but the simplest reliable path is to read
      // nextTokenId - 1 and confirm ownerOf(id) === walletAddress.
      const nextId = (await publicClient.readContract({
        address: PROXY_ADDRESS,
        abi: hatPetAbi,
        functionName: "nextTokenId",
        args: [],
      })) as bigint;
      let mintedId = nextId - 1n;

      // If multiple claims raced, walk back until we find one we own.
      for (let i = 0; i < 10 && mintedId > 0n; i++) {
        try {
          const owner = (await publicClient.readContract({
            address: PROXY_ADDRESS,
            abi: hatPetAbi,
            functionName: "ownerOf",
            args: [mintedId],
          })) as Address;
          if (owner.toLowerCase() === walletAddress.toLowerCase()) {
            break;
          }
        } catch {
          // ownerOf throws if not minted; keep walking back.
        }
        mintedId = mintedId - 1n;
      }
      setMintedTokenId(mintedId);

      // Fetch tokenURI and decode for the preview.
      try {
        const uri = (await publicClient.readContract({
          address: PROXY_ADDRESS,
          abi: hatPetAbi,
          functionName: "tokenURI",
          args: [mintedId],
        })) as string;
        const decoded = decodeTokenURI(uri);
        setMetadata(decoded);
      } catch {
        // ok if preview fails; user still has the NFT.
      }

      // Update branch so the UI flips to "claimed".
      setBranch({ kind: "claimed" });
      void receipt;
      void claimedEvent;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ==== Rendering ====

  const tokenShort = rawToken
    ? `${rawToken.slice(0, 6)}...${rawToken.slice(-6)}`
    : "";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <a
          href="/"
          className="text-2xl font-bold tracking-tight text-accent hover:opacity-80"
        >
          Hat Pets
        </a>
        <span className="font-mono text-xs text-muted">
          token: <span className="text-body">{tokenShort || "(none)"}</span>
        </span>
      </header>

      {loadState === "loading" && (
        <div className="rounded-lg border border-border bg-panel p-8 text-center text-muted">
          Reading claim state from Base...
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-lg border border-danger bg-panel p-8">
          <p className="text-danger">Something went wrong.</p>
          <p className="mt-2 break-all text-sm text-muted">{errorMessage}</p>
        </div>
      )}

      {loadState === "ready" && branch?.kind === "invalid" && (
        <InvalidView />
      )}

      {loadState === "ready" &&
        branch?.kind === "claimed" &&
        !mintedTokenId && <AlreadyClaimedView proxy={PROXY_ADDRESS} />}

      {loadState === "ready" && branch?.kind === "not_open_yet" && (
        <NotOpenYetView opensIn={formatCountdown(branch.opensAt - now)} />
      )}

      {loadState === "ready" && branch?.kind === "closed" && <ClosedView />}

      {loadState === "ready" && branch?.kind === "claimable" && (
        <ClaimableView
          spriteId={branch.spriteId}
          privyReady={privyReady}
          authenticated={authenticated}
          walletAddress={walletAddress}
          submitting={submitting}
          txHash={txHash}
          errorMessage={errorMessage}
          onLogin={login}
          onLogout={logout}
          onClaim={handleClaim}
          userEmail={user?.email?.address || null}
        />
      )}

      {mintedTokenId && (
        <SuccessView
          tokenId={mintedTokenId}
          metadata={metadata}
          proxy={PROXY_ADDRESS}
          isTestnet={activeChain.id === 84532}
        />
      )}
    </main>
  );
}

function InvalidView() {
  return (
    <div className="rounded-lg border border-border bg-panel p-8">
      <h2 className="text-2xl font-semibold text-accent">
        This URL is not a valid claim token
      </h2>
      <p className="mt-3 text-body">
        Either the token in your URL is malformed, or it was never seeded into
        the contract. Try tapping your hat again, or contact whoever gave you
        the hat.
      </p>
    </div>
  );
}

function AlreadyClaimedView({ proxy }: { proxy: Address }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-8">
      <h2 className="text-2xl font-semibold text-accent">
        This hat has already minted its pet
      </h2>
      <p className="mt-3 text-body">
        One claim per hat. The pet tied to this hat already lives on chain,
        owned by whoever tapped first.
      </p>
      <a
        href={`https://opensea.io/assets/base/${proxy}`}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-block rounded border border-accent px-4 py-2 text-sm text-accent hover:bg-accent hover:text-bg"
      >
        View collection on OpenSea
      </a>
    </div>
  );
}

function NotOpenYetView({ opensIn }: { opensIn: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-8 text-center">
      <h2 className="text-2xl font-semibold text-accent">Claim opens soon</h2>
      <p className="mt-3 text-body">
        Your hat is verified eligible. The claim window opens in{" "}
        <span className="font-mono text-accent">{opensIn}</span>.
      </p>
      <p className="mt-2 text-sm text-muted">
        Keep this page open; the button will unlock automatically.
      </p>
    </div>
  );
}

function ClosedView() {
  return (
    <div className="rounded-lg border border-border bg-panel p-8 text-center">
      <h2 className="text-2xl font-semibold text-accent">
        Claim window has closed
      </h2>
      <p className="mt-3 text-body">
        The mint window for this drop is over. Pets that were claimed in time
        will live on Base forever.
      </p>
    </div>
  );
}

type ClaimableViewProps = {
  spriteId: number;
  privyReady: boolean;
  authenticated: boolean;
  walletAddress: Address | null;
  submitting: boolean;
  txHash: Hex | null;
  errorMessage: string | null;
  userEmail: string | null;
  onLogin: () => void;
  onLogout: () => void;
  onClaim: () => void;
};

function ClaimableView(props: ClaimableViewProps) {
  const {
    spriteId,
    privyReady,
    authenticated,
    walletAddress,
    submitting,
    txHash,
    errorMessage,
    userEmail,
    onLogin,
    onLogout,
    onClaim,
  } = props;

  const connected = authenticated && !!walletAddress;
  const disabled = !privyReady || !connected || submitting;

  return (
    <div className="rounded-lg border border-border bg-panel p-8">
      <p className="text-sm uppercase tracking-widest text-muted">
        Hat verified
      </p>
      <h2 className="mt-2 text-3xl font-bold text-accent">
        Sprite #{spriteId} has been waiting for you.
      </h2>
      <p className="mt-3 text-body">
        Connect a wallet and claim your pet. One hat, one pet, forever.
      </p>

      <div className="mt-6 rounded border border-border bg-bg p-4">
        {connected ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted">
                Connected
              </p>
              <p className="font-mono text-sm text-body">
                {walletAddress}
                {userEmail ? (
                  <span className="ml-2 text-muted">({userEmail})</span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="text-xs text-muted underline hover:text-body"
            >
              disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onLogin}
            disabled={!privyReady}
            className="w-full rounded border border-accent px-4 py-3 text-accent transition hover:bg-accent hover:text-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {privyReady ? "Connect wallet" : "Loading..."}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onClaim}
        disabled={disabled}
        className="mt-6 w-full rounded bg-accent px-6 py-5 text-lg font-bold text-bg shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-border disabled:text-muted disabled:shadow-none"
      >
        {submitting
          ? "Claiming via private RPC..."
          : connected
            ? "Claim my Hat Pet"
            : "Connect wallet first"}
      </button>

      {txHash && (
        <p className="mt-3 break-all text-xs text-muted">
          tx submitted: <span className="font-mono">{txHash}</span>
        </p>
      )}

      {errorMessage && (
        <p className="mt-3 break-words text-sm text-danger">{errorMessage}</p>
      )}

      <p className="mt-6 text-xs text-muted">
        Submission goes through a private RPC (Flashbots Protect by default)
        so your claim cannot be sniped from the public mempool.
      </p>
    </div>
  );
}

function SuccessView({
  tokenId,
  metadata,
  proxy,
  isTestnet,
}: {
  tokenId: bigint;
  metadata: DecodedTokenMetadata | null;
  proxy: Address;
  isTestnet: boolean;
}) {
  const openseaBase = isTestnet
    ? "https://testnets.opensea.io/assets/base-sepolia"
    : "https://opensea.io/assets/base";
  const openseaUrl = `${openseaBase}/${proxy}/${tokenId.toString()}`;

  return (
    <div className="mt-8 rounded-lg border border-success bg-panel p-8 text-center">
      <p className="text-sm uppercase tracking-widest text-success">
        Claimed
      </p>
      <h2 className="mt-2 text-3xl font-bold text-accent">
        Token id #{tokenId.toString()} is yours.
      </h2>

      {metadata?.image && (
        <div className="mt-6 flex justify-center">
          {/* Inline data URI gif from on-chain bytecode */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={metadata.image}
            alt={metadata.name || `Hat Pet #${tokenId}`}
            className="pixelated sprite-256 rounded border border-border bg-bg"
          />
        </div>
      )}

      {metadata?.attributes && metadata.attributes.length > 0 && (
        <ul className="mt-6 grid grid-cols-2 gap-2 text-left text-sm">
          {metadata.attributes.map((attr, i) => (
            <li
              key={i}
              className="rounded border border-border bg-bg px-3 py-2"
            >
              <span className="text-muted">{attr.trait_type}: </span>
              <span className="text-body">{String(attr.value)}</span>
            </li>
          ))}
        </ul>
      )}

      <a
        href={openseaUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-8 inline-block rounded bg-accent px-6 py-3 font-semibold text-bg hover:brightness-110"
      >
        Open on OpenSea
      </a>
    </div>
  );
}
