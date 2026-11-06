// App module support.
import { useEffect } from 'react';
import { beginConfirmation, stateFromInfo, type PairingApi, type PairingState } from './pairing';
import { activeMachineId, defaultRelayUrl, setActiveMachineId } from './browser-pairing';
import { discoverRelayMachines } from '@shardrail/client/browser';

type PairingRuntime = {
  ready: boolean; setReady: (value: boolean) => void; count: number; streams: number; browserMain: boolean; b4Enabled: boolean;
  pairing: PairingState; setPairing: (value: PairingState) => void; pairingApi: PairingApi; isRelay: boolean;
  currentMachineId: string | null; setCurrentMachineId: (value: string | null) => void;
  setAvailableMachines: (value: { machine_id: string; online: boolean }[]) => void; browserMode: boolean;
};

export function usePairingEffects({ ready, setReady, count, streams, browserMain, b4Enabled, pairing, setPairing, pairingApi, isRelay, currentMachineId, setCurrentMachineId, setAvailableMachines, browserMode }: PairingRuntime) {
  useEffect(() => {
    if (b4Enabled) return;
    void pairingApi.inspect().then((info) => setPairing(stateFromInfo(info))).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Could not read daemon identity. Check that the daemon is installed and retry.';
      setPairing({ kind: 'error', message: msg });
    });
  }, []);
  useEffect(() => {
    if (b4Enabled || !isRelay || pairing.kind === 'paired') return;
    let cancelled = false;
    const relayUrl = defaultRelayUrl();
    const pollMachines = async () => {
      try {
        const machines = await discoverRelayMachines(relayUrl);
        if (cancelled) return;
        setAvailableMachines(machines);
        const online = machines.filter((m) => m.online);
        if (online.length > 0) {
          const chosen = (currentMachineId && online.some((m) => m.machine_id === currentMachineId))
            ? currentMachineId
            : online[0]!.machine_id;
          const machineChanged = chosen !== currentMachineId;
          if (machineChanged) {
            setActiveMachineId(chosen);
            setCurrentMachineId(chosen);
          }
          if (machineChanged || pairing.kind === 'error' || pairing.kind === 'loading') {
            void pairingApi.inspect()
              .then((next) => { if (!cancelled) setPairing(stateFromInfo(next)); })
              .catch((err) => {
                if (!cancelled) setPairing({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read daemon identity.' });
              });
          }
        } else {
          setActiveMachineId(null);
          setCurrentMachineId(null);
          if (pairing.kind === 'loading' || pairing.kind === 'error') {
            setPairing({ kind: 'error', message: 'Waiting for machine daemon to connect to relay...' });
          }
        }
      } catch {
        if (!cancelled && (pairing.kind === 'loading' || pairing.kind === 'error')) {
          setPairing({ kind: 'error', message: 'Waiting for relay connection...' });
        }
      }
    };
    void pollMachines();
    const interval = setInterval(pollMachines, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [b4Enabled, isRelay, pairing.kind, currentMachineId]);
  useEffect(() => {
    if (pairing.kind !== 'confirming') return;
    const timer = window.setTimeout(() => setPairing({ kind: 'expired', info: pairing.info }), Math.max(0, pairing.expiresAt - performance.now()));
    return () => window.clearTimeout(timer);
  }, [pairing]);
  useEffect(() => {
    if (!browserMode || pairing.kind !== 'paired' || pairing.info.keyStorage) return;
    void pairingApi.inspect().then((info) => setPairing(stateFromInfo(info))).catch(() => undefined);
  }, [pairing]);
}
