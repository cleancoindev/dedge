import ContractsContainer from "../../containers/Contracts";
import DACProxyContainer from "../../containers/DACProxy";
import { useState, useEffect } from "react";

import { dedgeHelpers } from "../../../smart-contracts/dist/helpers";
import ConnectionContainer from "../../containers/Connection";

const useMakerVaults = () => {
  const { address } = ConnectionContainer.useContainer();
  const { contracts, ready } = ContractsContainer.useContainer();
  const [vaultIds, setVaultIds] = useState([]);
  console.log("new vault ids", vaultIds)

  const getVaults = async () => {
    const { makerCdpManager, makerProxyRegistry } = contracts;
    const userMakerdaoProxyAddress = await makerProxyRegistry.proxies(address);

    const vaultIds = await dedgeHelpers.maker.getVaultIds(
      userMakerdaoProxyAddress,
      makerCdpManager,
    );

    console.log("retrieved vaults", vaultIds);
    setVaultIds(vaultIds);
  };

  useEffect(() => {
    if (ready) {
      getVaults();
    }
  }, [address]);

  return { vaultIds, getVaults };
};

export default useMakerVaults;
