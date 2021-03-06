import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "ethers";

import { dedgeHelpers } from "../helpers/index";

import {
  provider,
  legos,
  tryAndWait,
  newCTokenContract,
  getTokenFromUniswapAndApproveProxyTransfer
} from "./common";

import {
  dacProxyFactoryAddress,
  dedgeCompoundManagerAddress,
  addressRegistryAddress
} from "../build/DeployedAddresses.json";

import dacProxyDef from "../build/DACProxy.json";
import dacProxyFactoryDef from "../build/DACProxyFactory.json";
import dedgeCompoundManagerDef from "../build/DedgeCompoundManager.json";

chai.use(solidity);
const { expect } = chai;

const IDedgeCompoundManager = new ethers.utils.Interface(
  dedgeCompoundManagerDef.abi
);

// Have a unique wallet here to test the "buildAndEnterMarkets" functionality
const wallet = new ethers.Wallet(
  "0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913",
  provider
);

describe("DedgeCompoundManager", () => {
  const dacProxyFactoryContract = new ethers.Contract(
    dacProxyFactoryAddress,
    dacProxyFactoryDef.abi,
    wallet
  );

  let dacProxyContract: ethers.Contract; // Our proxy

  // Helper function to swap debt
  const swapDebt = async (
    oldCTokenAddress: string,
    newCTokenAddress: string
  ) => {
    const initialOldBorrow = await newCTokenContract(
      oldCTokenAddress
    ).borrowBalanceStored(dacProxyContract.address);
    const initialNewBorrow = await newCTokenContract(
      newCTokenAddress
    ).borrowBalanceStored(dacProxyContract.address);

    await tryAndWait(
      dedgeHelpers.compound.swapDebt(
        dacProxyContract,
        dedgeCompoundManagerAddress,
        addressRegistryAddress,
        oldCTokenAddress,
        initialOldBorrow, // Swap out 100%
        newCTokenAddress
      )
    );

    const finalOldBorrow = await newCTokenContract(
      oldCTokenAddress
    ).borrowBalanceStored(dacProxyContract.address);
    const finalNewBorrow = await newCTokenContract(
      newCTokenAddress
    ).borrowBalanceStored(dacProxyContract.address);

    expect(finalOldBorrow.lt(initialOldBorrow)).eq(true);
    expect(finalNewBorrow.gt(initialNewBorrow)).eq(true);
  };

  const swapCollateral = async (
    oldCTokenAddress: string,
    newCTokenAddress: string
  ) => {
    const initialOldSupply = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      oldCTokenAddress,
      dacProxyContract.address
    );
    const initialNewSupply = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      newCTokenAddress,
      dacProxyContract.address
    );

    await tryAndWait(
      dedgeHelpers.compound.swapCollateral(
        dacProxyContract,
        dedgeCompoundManagerAddress,
        addressRegistryAddress,
        oldCTokenAddress,
        initialOldSupply,
        newCTokenAddress
      )
    );

    const finalOldSupply = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      oldCTokenAddress,
      dacProxyContract.address
    );
    const finalNewSupply = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      newCTokenAddress,
      dacProxyContract.address
    );

    expect(finalOldSupply.lt(initialOldSupply)).eq(true);
    expect(finalNewSupply.gt(initialNewSupply)).eq(true);
  };

  before(async () => {
    // Builds DAC Proxy And enters the compound market
    const cTokensToEnter = [
      legos.compound.cEther.address,
      legos.compound.cSAI.address,
      legos.compound.cDAI.address,
      legos.compound.cREP.address,
      legos.compound.cUSDC.address,
      legos.compound.cBAT.address,
      legos.compound.cZRX.address,
      legos.compound.cWBTC.address
    ];

    await dedgeHelpers.proxyFactory.buildAndEnterMarkets(
      dacProxyFactoryContract,
      dedgeCompoundManagerAddress,
      cTokensToEnter
    );

    const dacProxyAddress = await dacProxyFactoryContract.proxies(
      wallet.address
    );

    dacProxyContract = new ethers.Contract(
      dacProxyAddress,
      dacProxyDef.abi,
      wallet
    );

    // Supplies 10 ETH and borrows 500 DAI from compound via ds-proxy
    const ethToSupply = 10;
    const daiToBorrow = 500;
    const supplyEthAndBorrowCalldata = IDedgeCompoundManager.functions.supplyETHAndBorrow.encode(
      [
        legos.compound.cDAI.address,
        ethers.utils.parseEther(daiToBorrow.toString())
      ]
    );
    await tryAndWait(
      dacProxyContract.execute(
        dedgeCompoundManagerAddress,
        supplyEthAndBorrowCalldata,
        {
          gasLimit: 4000000,
          value: ethers.utils.parseEther(ethToSupply.toString())
        }
      )
    );
  });

  it("Swapping Collateral (Supply) ETH -> USDC", async () => {
    const oldCTokenAddress = legos.compound.cEther.address;
    const newCTokenAddress = legos.compound.cUSDC.address;

    await swapCollateral(oldCTokenAddress, newCTokenAddress);
  });

  it("Swapping Collateral (Supply) USDC -> REP", async () => {
    const oldCTokenAddress = legos.compound.cUSDC.address;
    const newCTokenAddress = legos.compound.cREP.address;

    await swapCollateral(oldCTokenAddress, newCTokenAddress);
  });

  it("Swapping Collateral (Supply) REP -> ETHER", async () => {
    const oldCTokenAddress = legos.compound.cREP.address;
    const newCTokenAddress = legos.compound.cEther.address;

    await swapCollateral(oldCTokenAddress, newCTokenAddress);
  });

  it("supplyThroughProxy (ETH)", async () => {
    const targetCTokenAddress = legos.compound.cEther.address;
    const targetAmount = ethers.utils.parseUnits("1");

    const initialFunds = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    const calldata = IDedgeCompoundManager.functions.supplyThroughProxy.encode([
      targetCTokenAddress,
      targetAmount
    ]);

    await dacProxyContract.execute(dedgeCompoundManagerAddress, calldata, {
      gasLimit: 4000000,
      value: targetAmount
    });

    const finalFunds = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    expect(finalFunds.gt(initialFunds)).eq(true);
  });

  it("supplyThroughProxy (DAI)", async () => {
    const targetCTokenAddress = legos.compound.cDAI.address;
    const targetCTokenUnderlying = legos.erc20.dai.address;
    const targetAmount = ethers.utils.parseUnits("50");

    await getTokenFromUniswapAndApproveProxyTransfer(
      dacProxyContract.address,
      targetCTokenUnderlying,
      1, // Swaps 1 ETH
      wallet // Compound test file has a different wallet for ensuring entering markets work
    );

    const initialFunds = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    const calldata = IDedgeCompoundManager.functions.supplyThroughProxy.encode([
      targetCTokenAddress,
      targetAmount
    ]);

    await dacProxyContract.execute(dedgeCompoundManagerAddress, calldata, {
      gasLimit: 4000000
    });

    const finalFunds = await dedgeHelpers.compound.getCTokenBalanceOfUnderlying(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    expect(finalFunds.gt(initialFunds)).eq(true);
  });

  it("borrowThroughProxy (ETH)", async () => {
    const targetCTokenAddress = legos.compound.cEther.address;
    const targetAmount = ethers.utils.parseUnits("1");

    const initialBorrowed = await dedgeHelpers.compound.getCTokenBorrowBalance(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    const calldata = IDedgeCompoundManager.functions.borrowThroughProxy.encode([
      targetCTokenAddress,
      targetAmount
    ]);

    await dacProxyContract.execute(dedgeCompoundManagerAddress, calldata, {
      gasLimit: 4000000
    });

    const finalBorrowed = await dedgeHelpers.compound.getCTokenBorrowBalance(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    expect(finalBorrowed.gt(initialBorrowed)).eq(true);
  });

  it("borrowThroughProxy (DAI)", async () => {
    const targetCTokenAddress = legos.compound.cDAI.address;
    const targetAmount = ethers.utils.parseUnits("50");

    const initialBorrowed = await dedgeHelpers.compound.getCTokenBorrowBalance(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    const calldata = IDedgeCompoundManager.functions.borrowThroughProxy.encode([
      targetCTokenAddress,
      targetAmount
    ]);

    await dacProxyContract.execute(dedgeCompoundManagerAddress, calldata, {
      gasLimit: 4000000
    });

    const finalBorrowed = await dedgeHelpers.compound.getCTokenBorrowBalance(
      wallet,
      targetCTokenAddress,
      dacProxyContract.address
    );

    expect(finalBorrowed.gt(initialBorrowed)).eq(true);
  });

  it("Swapping Debt (Borrow) DAI -> BAT", async () => {
    const oldCTokenAddress = legos.compound.cDAI.address;
    const newCTokenAddress = legos.compound.cBAT.address;

    await swapDebt(oldCTokenAddress, newCTokenAddress);
  });

  it("Swapping Debt (Borrow) BAT -> ETH", async () => {
    const oldCTokenAddress = legos.compound.cBAT.address;
    const newCTokenAddress = legos.compound.cEther.address;

    await swapDebt(oldCTokenAddress, newCTokenAddress);
  });

  it("Swapping Debt (Borrow) ETH -> DAI", async () => {
    const oldCTokenAddress = legos.compound.cEther.address;
    const newCTokenAddress = legos.compound.cDAI.address;

    await swapDebt(oldCTokenAddress, newCTokenAddress);
  });
});
