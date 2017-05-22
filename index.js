var agent = require('auth0-instrumentation');
var pkg = require('./package.json');
var fs = require('fs');
var dirname = require('path').dirname;
var conciergeFile = dirname(__dirname) + '/concierge.json';

module.exports = function(context) {
  var env = { METRICS_API_KEY: context.config.METRICS_API_KEY, METRICS_PREFIX: 'auth0' };
  agent.init(pkg, env);

  // Initialize concierge on first run
  try {
    fs.accessSync(conciergeFile, fs.F_OK);
  } catch (e) {
    // It isn't accessible
    try {
      fs.writeFileSync(conciergeFile, '{}');
    } catch(er) {
      console.error('Unable to create concierge file');
    }
  }

  return {
    callConcierge: function(req, res) {
      try {
        var list = fs.readFileSync(conciergeFile);
        list = JSON.parse(list);

        agent.metrics.increment('concierge.messages', 1, { from: req.from.name, channel: req.channel.name, concierge: list[req.channel.name] || 'unassigned'});
        if (!list[req.channel.name]) {
          return res.text('No concierge assigned for this channel. Use `@concierge assign @user`').send();
        }

        var inChannelMatch = list[req.channel.name].match(/^in_channel ([^\s]+)/);

        if (inChannelMatch) {
          return res.text(inChannelMatch[1] + ' :point_up:').send();
        }
        else {
          var link = 'https://auth0.slack.com/archives/' + req.channel.name + '/p' + req.message.timestamp.replace('.', '');
          var conciergeMessage = '@' + req.from.name + ' needs your attention in #' + req.channel.name + ' (' + link + ') \n\n*Message*:\n';
          res.text(conciergeMessage + req.message.value.text, list[req.channel.name]);

          return res.text('A message has been sent to the concierge (`' + list[req.channel.name] + '`). If your message is urgent and you don\'t receive a reply within 15 minutes, please use `@here` or `@channel`.').send();
        }
      } catch (e) {
        return res.text('An error has occurred while trying to contact the concierge.\n```' + JSON.stringify(e) + '```').send();
      }
    },
    whosConcierge: function(req, res) {
      try {
        var list = fs.readFileSync(conciergeFile);
        list = JSON.parse(list);

        var conciergeName = list[req.channel.name];
        if (conciergeName) {
          return res.text('The concierge for this channel is `' + conciergeName + '`. To send a direct message to the concierge use `@concierge message: {text}`').send();
        }

        return res.text('This channel does not have a concierge assigned.').send();
      } catch (e) {
        return res.text('An error has occurred while trying to assign the concierge.\n```' + JSON.stringify(e) + '```').send();
      }
    },
    assignInChannel: function(req, res) {
      try {
        var list = fs.readFileSync(conciergeFile);
        list = JSON.parse(list);

        var name = req.params.name;
        if (name.charAt(0) === '@') {
          name = name.slice(1);
        }

        // req.param.name looks like @user-group(subteam.^S1AB2C34D) when using a Slack user-group
        // We're just pulling the handle out to ping the user-group
        var subteamMatch = name.match(/([^\s+]*)\((subteam\^.+)\)/);
        if (!subteamMatch) {
          return res.text('`in_channel` mode is only supported for subteams.').send();
        }

        // https://api.slack.com/docs/message-formatting#variables
        // Needs to look like <!subteam^ID|handle>
        name = '<!' + subteamMatch[2] + '|' + subteamMatch[1] + '>';
        list[req.channel.name] = 'in_channel ' + name;
        fs.writeFileSync(conciergeFile, JSON.stringify(list, null, 2));
        return res.text('Handle ' + name + ' has been assigned concierge for this channel.').send();
      } catch (e) {
        return res.text('An error has occurred while trying to assign the concierge.\n```' + JSON.stringify(e) + '```').send();
      }
    },
    assignConcierge: function(req, res) {
      try {
        var list = fs.readFileSync(conciergeFile);
        list = JSON.parse(list);

        var name = req.params.name;
        if (name.charAt(0) !== '@') {
          name = '@' + name;
        }

        // We can't DM subteams, so there's no point in allowing this
        var subteamMatch = name.match(/(@[^\s+]*)\(subteam\^.*\)/);
        if (subteamMatch) {
          return res.text('Cannot assign a subteam as concierge. Try using `@concierge in_channel: ' + subteamMatch[1] + '` instead.').send();
        }

        list[req.channel.name] = name;
        fs.writeFileSync(conciergeFile, JSON.stringify(list, null, 2));
        return res.text('User ' + name + ' has been assigned concierge for this channel.').send();
      } catch (e) {
        return res.text('An error has occurred while trying to assign the concierge.\n```' + JSON.stringify(e) + '```').send();
      }
    },
    clearConcierge: function(req, res) {
      try {
        var list = fs.readFileSync(conciergeFile);
        list = JSON.parse(list);

        if (list[req.channel.name]) {
          delete list[req.channel.name];
          fs.writeFileSync(conciergeFile, JSON.stringify(list, null, 2));
          return res.text('Unassigned concierge for this channel.').send();
        }

        return res.text('This channel does not have a concierge assigned. Nothing changed.').send();
      } catch (e) {
        return res.text('An error has occurred while trying to unassign the concierge.\n```' + JSON.stringify(e) + '```').send();
      }
    },
    help: function(req, res) {
      var helpMessage = "Here\'s what I can do:\n- Use `@concierge who` to check who is the assigned concierge for this channel.\n- Use `@concierge assign: {user}` to assign a person to the current channel (user will be notified by DM).\n- Use `concierge in_channel: {subteam}` to assign a user group as the concierge (that will be notified in the channel itself).\n- Use `concierge message: {text}` to send a direct message to the concierge.\n- Use `concierge stop: on-call` to clear the assignment for this channel.";
      return res.text(helpMessage).send();
    }
  };
};
