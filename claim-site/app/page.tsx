export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-5xl font-bold tracking-tight text-accent">
        Hat Pets
      </h1>
      <p className="mt-4 text-lg text-body">
        Hat-gated, fully on-chain animated tamagotchi NFTs on Base.
      </p>
      <div className="mt-12 w-full rounded-lg border border-border bg-panel p-6 text-left">
        <p className="text-sm uppercase tracking-widest text-muted">
          Heads up
        </p>
        <p className="mt-2 text-body">
          Your hat tap should have brought you here with a{" "}
          <span className="font-mono text-accent">/c/&lt;token&gt;</span> URL.
          If you landed here without one, your hat&apos;s NFC chip may not be
          encoded yet (or you tapped a non-Hat-Pet hat).
        </p>
        <p className="mt-4 text-sm text-muted">
          One claim per hat. One pet per claim. Wallet-agnostic: any wallet
          that taps a given hat first wins the pet for that hat.
        </p>
      </div>
    </main>
  );
}
