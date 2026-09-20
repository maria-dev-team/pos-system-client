import { callLocalPos, localPosActive } from '@renderer/common/lib/local-pos';

import { PosError } from '../../../../shared/pos/contracts';

export async function prepareCashMovement(): Promise<void> {
  if (!localPosActive()) return;
  try {
    await callLocalPos({ type: 'prepareCashMovement' });
  } catch (error) {
    // HMR may update the renderer while Electron still runs the previous IPC
    // schema. Its flush command enforces the same safety checks and additionally
    // requires draft/held receipts to be closed. Never bypass synchronization.
    if (!(error instanceof PosError) || error.code !== 'INVALID_REQUEST')
      throw error;
    await callLocalPos({ type: 'flush' });
  }
}
