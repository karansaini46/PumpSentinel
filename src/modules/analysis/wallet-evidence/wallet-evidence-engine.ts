import {
  type RelatedWalletsAnalysis,
  type WalletConnectionEvidence,
  type DismissedWalletLink,
  type WalletEvidenceType,
  createField,
  createUnknownField,
} from '../analysis.types.js';

export interface RawWalletEvidenceItem {
  walletA: string;
  walletB: string;
  type:
    | 'COMMON_FUNDER'
    | 'DIRECT_TRANSFER'
    | 'SHARED_FEE_PAYER'
    | 'CO_SIGNER'
    | 'SAME_TOKEN_TRADED'
    | 'SAME_POOL_INTERACTION';
  funderAddress?: string;
  signature?: string;
  amountSol?: number;
  description?: string;
  timestamp?: Date;
}

export class WalletEvidenceEngine {
  /**
   * Evaluates candidate wallet links and enforces the strict rule:
   * "Do not claim that wallets are connected merely because they bought the same token."
   */
  public evaluateLinks(
    targetWallet: string,
    candidates: RawWalletEvidenceItem[],
  ): RelatedWalletsAnalysis {
    const linkedWallets: WalletConnectionEvidence[] = [];
    const dismissedLinks: DismissedWalletLink[] = [];
    const seenLinks = new Set<string>();

    for (const item of candidates) {
      const linkKey = [item.walletA, item.walletB].sort().join(':') + `:${item.type}`;
      if (seenLinks.has(linkKey)) continue;
      seenLinks.add(linkKey);

      // Invariant: Reject mere same-token trading as evidence
      if (item.type === 'SAME_TOKEN_TRADED' || item.type === 'SAME_POOL_INTERACTION') {
        dismissedLinks.push({
          walletA: item.walletA,
          walletB: item.walletB,
          claimedRelation: item.type,
          reason:
            'Trading or holding the same token is normal open-market activity and does NOT constitute cryptographic or on-chain evidence of wallet connection.',
        });
        continue;
      }

      // Valid evidence types
      let validEvidenceType: WalletEvidenceType | null = null;
      let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
      let description = item.description ?? '';

      switch (item.type) {
        case 'COMMON_FUNDER': {
          if (!item.funderAddress) {
            dismissedLinks.push({
              walletA: item.walletA,
              walletB: item.walletB,
              claimedRelation: item.type,
              reason: 'Common funder claim lacks explicit funder address.',
            });
            continue;
          }
          validEvidenceType = 'COMMON_FUNDER';
          confidence = 'HIGH';
          description =
            description ||
            `Both wallets were directly funded by common parent address ${item.funderAddress}`;
          break;
        }

        case 'DIRECT_TRANSFER': {
          validEvidenceType = 'DIRECT_TRANSFER';
          confidence = 'HIGH';
          description =
            description ||
            `Direct transfer of ${item.amountSol ? item.amountSol + ' SOL' : 'assets'} observed between wallets`;
          break;
        }

        case 'SHARED_FEE_PAYER': {
          validEvidenceType = 'SHARED_FEE_PAYER';
          confidence = 'HIGH';
          description =
            description || 'Transactions across distinct wallets were funded by the same fee payer';
          break;
        }

        case 'CO_SIGNER': {
          validEvidenceType = 'CO_SIGNER';
          confidence = 'HIGH';
          description = description || 'Wallets co-signed the same multisig or batch transaction';
          break;
        }

        default:
          dismissedLinks.push({
            walletA: item.walletA,
            walletB: item.walletB,
            claimedRelation: String(item.type),
            reason: 'Unknown or unsupported relationship type.',
          });
          continue;
      }

      if (validEvidenceType) {
        linkedWallets.push({
          targetWallet: item.walletA === targetWallet ? item.walletA : item.walletB,
          relatedWallet: item.walletA === targetWallet ? item.walletB : item.walletA,
          evidenceType: validEvidenceType,
          confidence,
          description,
          funderAddress: item.funderAddress,
          transactionSignature: item.signature,
          transferAmountSol: item.amountSol,
          detectedAt: item.timestamp ?? new Date(),
        });
      }
    }

    const hasSybilCluster = linkedWallets.length >= 3;

    return {
      linkedWallets: createField(linkedWallets, {
        source: 'wallet_evidence_engine',
        confidence: linkedWallets.length > 0 ? 'HIGH' : 'MEDIUM',
        nature: 'DIRECT',
      }),
      connectedWalletCount: createField(linkedWallets.length, {
        source: 'wallet_evidence_engine',
        confidence: 'HIGH',
        nature: 'DIRECT',
      }),
      dismissedNonEvidenceLinks: createField(dismissedLinks, {
        source: 'wallet_evidence_engine',
        confidence: 'HIGH',
        nature: 'DIRECT',
        reason: 'Filtered out non-evidence associations such as trading the same token.',
      }),
      hasSybilCluster: createField(hasSybilCluster, {
        source: 'wallet_evidence_engine',
        confidence: 'MEDIUM',
        nature: 'INFERRED',
      }),
    };
  }

  public createEmptyAnalysis(
    reason = 'No wallet relationship scan performed',
  ): RelatedWalletsAnalysis {
    return {
      linkedWallets: createUnknownField<WalletConnectionEvidence[]>(
        'wallet_evidence_engine',
        reason,
      ),
      connectedWalletCount: createUnknownField<number>('wallet_evidence_engine', reason),
      dismissedNonEvidenceLinks: createField([], {
        source: 'wallet_evidence_engine',
        confidence: 'HIGH',
        nature: 'DIRECT',
      }),
      hasSybilCluster: createUnknownField<boolean>('wallet_evidence_engine', reason),
    };
  }
}

export const walletEvidenceEngine = new WalletEvidenceEngine();
