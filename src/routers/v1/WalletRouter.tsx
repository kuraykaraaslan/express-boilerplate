/*
 * This file is responsible for handling all the routes related to the wallet of the user.  
*/

import express from "express"
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import Response from '../../response/Response';
import Request from '../../request/Request';
import authMiddleware from "../../middlewares/authMiddleware";
import WalletService from "../../services/Wallet/";

const WalletRouter = express.Router();

WalletRouter.use(authMiddleware('ADMIN'));

/*
    Those routes are private and can only be accessed by authenticated users.
*/

WalletRouter.get('/',
    
        errorHandlerWrapper(
            async (req, res) => {

                var { page, pageSize, network } = req.query as any;

                if (!page) {
                  page = 0;
                }

                if (!pageSize) {
                  pageSize = 10;
                }

                if (network) {
                    WalletService.validateNetwork(network);
                }

                const regex = /^[0-9]+$/;

                if (!regex.test(page) || !regex.test(pageSize)) {
                    return res.status(400).json({ message: "INVALID_PAGE_OR_PAGE_SIZE" });
                }

                const result = await WalletService.listAllWallets(page, pageSize, network);
    
                return res.status(201).json(result);
    
            }
        )
);  


export default WalletRouter;