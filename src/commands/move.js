const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { execute } = require('../core/executor');
module.exports = {
  data: new SlashCommandBuilder().setName("move").setDescription("Move a member to another voice channel.")
    .addUserOption(o=>o.setName("user").setDescription("Member to move").setRequired(true))
    .addChannelOption(o=>o.setName("channel").setDescription("Destination voice channel").setRequired(true).addChannelTypes(ChannelType.GuildVoice,ChannelType.GuildStageVoice))
    .addStringOption(o=>o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),
  async execute(interaction,{getConfig,saveConfig}){
    const user=interaction.options.getUser("user"), destination=interaction.options.getChannel("channel"), reason=interaction.options.getString("reason")||"Slash command voice move.";
    const member=await interaction.guild.members.fetch(user.id).catch(()=>null);
    if(!member)return interaction.reply({content:"I can't find that member in this server.",ephemeral:true});
    const result=await execute({message:interaction,action:'voicemove',target:member,destination,reason,config:getConfig(interaction.guild.id),saveConfig});
    return interaction.reply({content:result.ok?`🔀 **${user.tag}** moved to **${destination.name}**.`:result.text,ephemeral:!result.ok});
  }
};
