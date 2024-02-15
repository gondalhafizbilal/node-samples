
const axios                                = require('axios').default;
const { Debug }                            = require('@project/utils');
const { logInfo, logError }                = Debug('app:libs:appleApi');
const ProjectConfigSingleton               = require('@project/libs/configuration');
const appleConfig                          = ProjectConfigSingleton().getConfig('payment_gateways').apple;
const notificationPassword                 = appleConfig.notificationPassword;

const appleVerifyReceiptSandBoxEndpoint    = 'https://sandbox.itunes.apple.com/verifyReceipt';
const appleVerifyReceiptProductionEndpoint = 'https://buy.itunes.apple.com/verifyReceipt';

const AppleVerifyReceipt = {
    verifyReceipt: (latestReceipt) => {
        logInfo('verifying apple receipt', latestReceipt)
        const payload = {
            'password': notificationPassword,
            'receipt-data': latestReceipt
        }

        return new Promise(async (resolve, reject) => {
            try {
                logInfo('trying with apple sandbox endpoint', appleVerifyReceiptSandBoxEndpoint);
                const verifyReceiptSandBoxResponse = await axios({
                    method: 'POST',
                    url: appleVerifyReceiptSandBoxEndpoint,
                    data: payload
                });
                logInfo('received apple sandbox endpoint response', verifyReceiptSandBoxResponse);
                let responseData = null;
                if (verifyReceiptSandBoxResponse.status === 200) {
                    switch (verifyReceiptSandBoxResponse.data.status) {
                        case 0:
                            responseData = verifyReceiptSandBoxResponse.data;
                            break;
                        case 21008:
                            logInfo('trying with apple production endpoint', appleVerifyReceiptProductionEndpoint)
                            const verifyReceiptProductionResponse = await axios({
                                method: 'POST',
                                url: appleVerifyReceiptProductionEndpoint,
                                data: payload
                            });
    
                            logInfo('received apple production endpoint response', verifyReceiptProductionResponse)
                            if (verifyReceiptProductionResponse.status === 200 &&
                                verifyReceiptProductionResponse.data &&
                                verifyReceiptProductionResponse.data.status === 0
                            ) {
                                responseData = verifyReceiptProductionResponse.data;
                            }
                            break;
                        default:
                            break;
                    }
                }
                resolve(responseData)
            } catch (error) {
                logError('error while verifying apple reciept', error);
                reject(error);
            }
        })
    }
}

module.exports = {
    AppleVerifyReceipt
};

