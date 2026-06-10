async function main() {
  const WalletVault = await ethers.getContractFactory('WalletVault')
  const walletVault = await WalletVault.deploy()
  await walletVault.waitForDeployment()

  console.log('WalletVault deployed to:', await walletVault.getAddress())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
