import { Request, Response } from 'express';
import { UserType } from '../models';
import { check, validationResult} from 'express-validator';

export class UserTypeController{
  public validate (method: string) {
    switch(method) {
      case 'createUserType': {
        return [
          check("name").custom(async (value) => {
            const userType = await UserType.findOne({
              where: {
                name: value,
              }
            });
            if (userType) {
              return Promise.reject('User Type with same name already exists');
            }
          }).not().isEmpty().withMessage("Name can't be blank")
        ]
      }
    }
  }

  public async getUserTypes (req: Request, res: Response) {
    const userTypes: UserType[] = await UserType.findAll({});
    res.status(200).json({ success: true, data: userTypes });
  }

  public async addNewUserType (req: Request, res: Response) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ success: false, errors: errors.array() });
      }

      const userType = await UserType.create({
        name: req.body.name,
      });
      if (userType) {
        res.json({
          success: true,
          data: { id: userType.id, name: userType.name }
        });
      } else {
        res.json({
          success: false,
          errors: [{ msg: "Unable to create User Type" }]
        });
      }
    } catch(errors) {
      res.status(422).json({
        success: false,
        errors
      })
    }
  }
}