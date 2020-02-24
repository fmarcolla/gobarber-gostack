import Notification from '../schemas/Notification';
import User from '../models/User';

class NotificationController {
  async index(req, res) {
    const isProvider = await User.findOne({
      where: { id: req.userId, provider: true }
    });

    if (!isProvider) {
      return res
        .status(401)
        .json({ error: 'Only providers can load notifications!' });
    }

    const notifications = await Notification.find({
      user: req.userId
    })
      .sort({ createdAt: 'desc' })
      .limit(20);

    return res.json(notifications);
  }

  async update(req, res) {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id, // id da notificação
      { read: true }, // seta o campo read como true
      { new: true } // traz o novo registro já alterado
    );

    return res.json(notification);
  }
}

export default new NotificationController();
