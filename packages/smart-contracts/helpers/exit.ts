import { ethers } from "ethers";
import { BigNumber } from "ethers/utils/bignumber";
import { Address } from "./types";
import compound from "./compound";

import { getLegos, networkIds } from "money-legos";

import dedgeExitManagerDef from "../artifacts/DedgeExitManager.json";
import { getCustomGasPrice } from "./common";

const legos = getLegos(networkIds.mainnet);

const IDedgeExitManager = new ethers.utils.Interface(dedgeExitManagerDef.abi);

const getExitPositionParameters = async (
  signer: ethers.Wallet,
  dacProxy: Address
) => {
  const getTokenToEthPrice = async (cToken, amountWei) => {
    if (cToken === legos.compound.cEther.address) {
      return amountWei;
    }

    const tokenAddress = await newCTokenContract(cToken).underlying();

    const uniswapExchangeAddress = await uniswapFactoryContract.getExchange(
      tokenAddress
    );

    const uniswapExchangeContract = new ethers.Contract(
      uniswapExchangeAddress,
      legos.uniswap.exchange.abi,
      signer
    );

    return await uniswapExchangeContract.getEthToTokenOutputPrice(
      amountWei.toString()
    );
  };

  const newCTokenContract = (curCToken: Address) =>
    new ethers.Contract(curCToken, legos.compound.cTokenAbi, signer);

  const comptrollerContract = new ethers.Contract(
    legos.compound.comptroller.address,
    legos.compound.comptroller.abi,
    signer
  );

  const uniswapFactoryContract = new ethers.Contract(
    legos.uniswap.factory.address,
    legos.uniswap.factory.abi,
    signer
  );

  const enteredMarkets = await comptrollerContract.getAssetsIn(dacProxy);

  // tslint:disable-next-line
  const debtCollateralInTokens: [
    Address,
    BigNumber,
    BigNumber
  ][] = await Promise.all(
    enteredMarkets.map(async (x: Address) => {
      const {
        balanceOfUnderlying,
        borrowBalance
      } = await compound.getAccountSnapshot(signer, x, dacProxy);

      return [x, borrowBalance, balanceOfUnderlying];
    })
  );

  const debtMarketsInTokens: [Address, BigNumber][] = debtCollateralInTokens
    .filter((x: [Address, BigNumber, BigNumber]) => x[1] > new BigNumber(0))
    .map((x: [Address, BigNumber, BigNumber]): [Address, BigNumber] => {
      return [x[0], x[1]];
    });

  const collateralMarketsInTokens: [Address, BigNumber][] = debtCollateralInTokens
    .filter((x: [Address, BigNumber, BigNumber]) => x[2] > new BigNumber(0))
    .map((x: [Address, BigNumber, BigNumber]): [Address, BigNumber] => {
      return [x[0], x[2].mul(999999).div(1000000)]; // Withdraw 99.9999% might fail at 100% due to comptroller...
    });

  const debtInEth = await Promise.all(
    debtMarketsInTokens
      .map((x: [Address, BigNumber]) => getTokenToEthPrice(x[0], x[1]))
  );

  const ethersToBorrow = debtInEth.reduce((a, b) => a.add(b), new BigNumber(0))

  return {
    etherToBorrowWeiBN: ethersToBorrow,
    debtMarkets: debtMarketsInTokens,
    collateralMarkets: collateralMarketsInTokens
  };
};

const exitPositionToETH = async (
  exitToUser: Address,
  etherToBorrowWei: BigNumber,
  dacProxy: ethers.Contract,
  addressRegistry: Address,
  dedgeExitManager: Address,
  debtMarkets: [Address, BigNumber][],
  collateralMarkets: [Address, BigNumber][],
  overrides: any = { gasLimit: 6000000 }
): Promise<any> => {
  // struct DebtMarket {
  //     address cToken;
  //     uint256 amount;
  // }

  // struct CollateralMarket {
  //     address cToken;
  //     uint256 amount;
  // }

  // struct ExitPositionCalldata {
  //     address payable exitUserAddress;
  //     address addressRegistryAddress;
  //     DebtMarket[] debtMarket;
  //     CollateralMarket[] collateralMarket;
  // }

  // uint(32) prefix
  const abiPrefix = ethers.utils.defaultAbiCoder.encode(["uint"], [32]);
  const abiExitUserAddress = ethers.utils.defaultAbiCoder.encode(
    ["address"],
    [exitToUser]
  );
  const abiAddressRegistryAddress = ethers.utils.defaultAbiCoder.encode(
    ["address"],
    [addressRegistry]
  );

  // Remove uint(32) prefix
  const abiDebtMarkets = ethers.utils.defaultAbiCoder
    .encode(["tuple(address,uint)[]"], [debtMarkets])
    .slice(66);

  const abiCollateralMarkets = ethers.utils.defaultAbiCoder
    .encode(["tuple(address,uint)[]"], [collateralMarkets])
    .slice(66);

  // debtCTokens positioning (always starts at 128)
  // address (padded) 32 +
  // address (padded) 32 +
  // start of 1st dynamic array (padded) 32 +
  // start of 2nd dynamic array (padded) 32
  const abiDebtCTokensStartPosition = ethers.utils.defaultAbiCoder.encode(
    ["uint"],
    [128]
  );

  // Collateral CTokens position (starts at 128 + 32 + (2 * 32* debtCToken.length))
  // the extra 32 is the storage of the length of abiDebtCTokens
  const abiCollateralCTokensStartPosition = ethers.utils.defaultAbiCoder.encode(
    ["uint"],
    [128 + 32 + 2 * 32 * debtMarkets.length]
  );

  const exitPositionsPostLoan =
    "0x" +
    (
      abiPrefix +
      abiExitUserAddress +
      abiAddressRegistryAddress +
      abiDebtCTokensStartPosition +
      abiCollateralCTokensStartPosition +
      abiDebtMarkets +
      abiCollateralMarkets
    )
      .split("0x")
      .join("");

  const executeOperationCalldataParams = IDedgeExitManager.functions.exitPositionsPostLoan.encode(
    [
      0,
      0,
      0, // Doesn't matter as the variables will be re-injected by `executeOption` anyway
      exitPositionsPostLoan
    ]
  );

  const exitPositionsCallbackdata = IDedgeExitManager.functions.exitPositions.encode(
    [
      // Wanna loan 107% dacProxyinstead of 100% due to potential slippages
      etherToBorrowWei
        .mul(107)
        .div(100)
        .toString(),
      dedgeExitManager,
      dacProxy.address,
      addressRegistry,
      executeOperationCalldataParams
    ]
  );

  const gasPrice = await getCustomGasPrice(dacProxy.provider);
  const newOverrides = Object.assign({ gasPrice }, overrides);

  return dacProxy.execute(
    dedgeExitManager,
    exitPositionsCallbackdata,
    newOverrides
  );
};

export default {
  exitPositionToETH,
  getExitPositionParameters
};
