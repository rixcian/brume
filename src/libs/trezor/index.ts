import TrezorConnect, { Address, Success } from "@trezor/connect-web";
import { HDNodeResponse } from "@/libs/trezor/types";

export class Trezor {
  private static instance: Trezor | null = null

  private constructor() {
    // Private constructor to prevent instantiation
  }

  public static getInstance(): Trezor {
    if (!Trezor.instance) {
      Trezor.instance = new Trezor()

      TrezorConnect.init({
        lazyLoad: true, // this param will prevent iframe injection until TrezorConnect.method will be called
        manifest: {
          email: 'developer@xyz.com',
          appUrl: 'http://your.application.com',
        },
      })
    }

    return Trezor.instance;
  }

  public async getEthereumAddressAtIndex(index: number): Promise<string> {
    const result = await TrezorConnect.ethereumGetAddress({
      path: `m/44'/60'/${index}'/0/0`,
      showOnTrezor: false,
    });

    if (result.success) {
      const {payload} = result as Success<Address>;
      return payload.address;
    }

    throw new Error(result.payload.error);
  }

  public async getEthereumAddressesToIndex(endIndex: number): Promise<string[]> {
    const result = await TrezorConnect.ethereumGetAddress({
      bundle: Array.from(Array(endIndex).keys()).map(index => ({
        path: `m/44'/60'/${index}'/0/0`,
        showOnTrezor: false,
      })),
    });

    if (result.success) {
      const { payload } = result as Success<Address[]>;
      return payload.map(address => address.address);
    }

    throw new Error(result.payload.error);
  }

  public async getEthereumPublicKeyAtIndex(index: number): Promise<string> {
    const result = await TrezorConnect.ethereumGetPublicKey({
      path: `m/44'/60'/${index}'/0/0`,
      showOnTrezor: false,
    });

    if (result.success) {
      const { payload } = result as Success<HDNodeResponse>;
      return payload.publicKey;
    }

    throw new Error(result.payload.error);
  }

  public async getEthereumPublicKeysToIndex(endIndex: number): Promise<string[]> {
    const result = await TrezorConnect.ethereumGetPublicKey({
      bundle: Array.from(Array(endIndex).keys()).map(index => ({
        path: `m/44'/60'/${index}'/0/0`,
        showOnTrezor: false,
      })),
    })

    if (result.success) {
      const { payload } = result as Success<HDNodeResponse[]>;
      return payload.map(response => response.publicKey);
    }

    throw new Error(result.payload.error);
  }
}