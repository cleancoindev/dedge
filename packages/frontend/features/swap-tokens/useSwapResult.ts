import { ethers } from "ethers";
import { getLegos, networkIds } from "money-legos";

import { BigNumber } from "ethers/utils/bignumber";

const legos = getLegos(networkIds.mainnet);

const useSwapResult = async (
  signer: ethers.Signer,
  fromToken: null | string, // null means its ETH
  toToken: null | string, // null means its ETH
  amountWei: BigNumber
): Promise<BigNumber> => {
  const uniswapFactory = new ethers.Contract(
    legos.uniswap.factory.address,
    legos.uniswap.factory.abi,
    signer
  );

  if (fromToken === toToken) {
    return amountWei;
  }

  let fromInEth = amountWei;
  // If from isn't ETH, calculate it's worth in ETH
  if (fromToken !== null) {
    const fromExchangeAddress = await uniswapFactory.getExchange(fromToken);

    const fromExchange = new ethers.Contract(
      fromExchangeAddress,
      legos.uniswap.exchange.abi,
      signer
    );

    // From token to ETH
    fromInEth = await fromExchange.getTokenToEthInputPrice(
      amountWei.toString()
    );
  }

  // Calculate it's worth in output tokens

  // If the output token is just ETH, return fromInEth
  if (toToken === null) {
    return fromInEth;
  }

  console.log("fromInEth", fromInEth);

  // Else calculate the output in token worth
  const toExchangeAddress = await uniswapFactory.getExchange(toToken);

  const toExchange = new ethers.Contract(
    toExchangeAddress,
    legos.uniswap.exchange.abi,
    signer
  );

  return toExchange.getEthToTokenInputPrice(fromInEth.toString());
};

export default useSwapResult;
